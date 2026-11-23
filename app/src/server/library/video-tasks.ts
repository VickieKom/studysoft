// A library video's tasks (#326): the assistant drafts them from the video's
// transcript, the teacher removes what she does not want and confirms; the
// confirmed tasks are the ones a student gets (#327). The draft lies beside
// the confirmed tasks and replaces them only when she confirms it. Tasks are
// kept in the homework format, so that the same tasks can go into homework
// (#330). The teacher's and the assistant's only: no student, parent or link
// procedure reads this module.
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { partPictures, type StudentTask, studentView, type Task, validateHomework } from "../../domain/homework-format";
import type { Database } from "../db/client";
import { libraryMaterial, videoTasks } from "../db/schema";

/** The most tasks one video has: a few minutes of video, a few questions. */
export const MAX_VIDEO_TASKS = 20;

/** A library video of this teacher: the material its tasks belong to. */
const ownVideo = (teacherId: string, materialId: string) =>
  and(eq(libraryMaterial.id, materialId), eq(libraryMaterial.teacherId, teacherId), eq(libraryMaterial.kind, "video"), eq(libraryMaterial.draft, false));

export type LibraryVideo = { id: string; title: string; link: string | null; transcript: string | null };

/** A video of this teacher's library with its link and transcript, for the assistant; null when there is none. */
export async function libraryVideo(database: Database, teacherId: string, materialId: string): Promise<LibraryVideo | null> {
  const [row] = await database
    .select({ id: libraryMaterial.id, title: libraryMaterial.title, link: libraryMaterial.url, transcript: libraryMaterial.transcript })
    .from(libraryMaterial)
    .where(ownVideo(teacherId, materialId));
  return row ?? null;
}

/**
 * Checks the assistant's tasks against the homework format, at most 20 tasks.
 * shortcut: no picture or recording in a video's tasks, they would need a file address of their own for the student; add one when a video task needs a picture (#326)
 */
export function checkVideoTasks(document: unknown): { ok: true; tasks: Task[] } | { ok: false; errors: string[] } {
  const parsed = validateHomework(document);
  if (!parsed.ok) return parsed;
  const { tasks } = parsed.homework;
  if (tasks.length > MAX_VIDEO_TASKS) return { ok: false, errors: [`tasks: не больше ${MAX_VIDEO_TASKS} заданий к одному видео`] };
  const errors = tasks.flatMap((task, index) =>
    task.image || task.audio || partPictures(task).length > 0
      ? [`Задание ${index + 1}: в заданиях к видео пока нет картинок и записей — только текст`]
      : [],
  );
  return errors.length > 0 ? { ok: false, errors: errors.slice(0, 10) } : { ok: true, tasks };
}

export type SavedTasks = "saved" | "not_found" | "edited" | { errors: string[] };

/**
 * The assistant's tasks for a library video, saved as its draft. One
 * conditional write: it replaces the draft while the teacher has done
 * nothing to it; once her «Убрать» has touched it, the save is refused, so
 * her edit is never lost. The confirmed tasks stay until she confirms.
 */
export async function saveAssistantVideoTasks(database: Database, teacherId: string, materialId: string, document: unknown): Promise<SavedTasks> {
  if (!(await libraryVideo(database, teacherId, materialId))) return "not_found";
  const checked = checkVideoTasks(document);
  if (!checked.ok) return { errors: checked.errors };
  const rows = await database
    .insert(videoTasks)
    .values({ teacherId, materialId, draft: checked.tasks })
    .onConflictDoUpdate({
      target: videoTasks.materialId,
      set: { draft: checked.tasks, draftEditedAt: null, updatedAt: sql`now()` },
      // A video is one teacher's; her edited draft is kept. A confirmed draft is gone, so a new one is untouched.
      setWhere: and(eq(videoTasks.teacherId, teacherId), sql`(${videoTasks.draft} IS NULL OR ${videoTasks.draftEditedAt} IS NULL)`),
    })
    .returning({ id: videoTasks.id });
  return rows.length > 0 ? "saved" : "edited";
}

/** The draft as the teacher's page loaded it: «Убрать» and «Подтвердить» are refused once the assistant replaced it. */
const draftRevision = sql<string>`md5(coalesce(${videoTasks.draft}::text, ''))`;

export type VideoTasksView = {
  /** The confirmed tasks as the child will see them, or null before the first confirmation. */
  confirmed: StudentTask[] | null;
  /** The assistant's draft as the child will see it, with the revision the page sends back. */
  draft: { tasks: StudentTask[]; revision: string } | null;
};

const asStudent = (rowId: string, list: "tasks" | "draft", tasks: Task[]) => tasks.map((task, index) => studentView(task, `${rowId}:${list}:${index}`));

/** «Задания к видео» on the video's page; null when the video is not this teacher's. */
export async function readVideoTasks(database: Database, teacherId: string, materialId: string): Promise<VideoTasksView | null> {
  if (!(await libraryVideo(database, teacherId, materialId))) return null;
  const [row] = await database
    .select({ id: videoTasks.id, tasks: videoTasks.tasks, draft: videoTasks.draft, revision: draftRevision })
    .from(videoTasks)
    .where(and(eq(videoTasks.teacherId, teacherId), eq(videoTasks.materialId, materialId)));
  return {
    confirmed: row?.tasks ? asStudent(row.id, "tasks", row.tasks as Task[]) : null,
    draft: row?.draft ? { tasks: asStudent(row.id, "draft", row.draft as Task[]), revision: row.revision } : null,
  };
}

export type ChangedTasks = "saved" | "not_found" | "conflict" | "last";

const videoRow = (teacherId: string, materialId: string) => and(eq(videoTasks.teacherId, teacherId), eq(videoTasks.materialId, materialId));

/** "conflict" when the video has a draft, "not_found" when it has none: what a refused conditional write meant. */
async function refused(database: Database, teacherId: string, materialId: string): Promise<"not_found" | "conflict"> {
  const [row] = await database
    .select({ id: videoTasks.id })
    .from(videoTasks)
    .where(and(videoRow(teacherId, materialId), isNotNull(videoTasks.draft)));
  return row ? "conflict" : "not_found";
}

/**
 * «Убрать»: takes one task out of the draft, as the teacher's page showed it
 * (`revision`), and marks the draft hers, so the assistant no longer replaces
 * it. The last task stays: a draft without tasks is not one.
 */
export async function removeVideoDraftTask(database: Database, teacherId: string, materialId: string, index: number, revision: string): Promise<ChangedTasks> {
  const rows = await database
    .update(videoTasks)
    .set({ draft: sql`${videoTasks.draft} - ${index}::int`, draftEditedAt: sql`coalesce(${videoTasks.draftEditedAt}, now())`, updatedAt: sql`now()` })
    .where(
      and(
        videoRow(teacherId, materialId),
        sql`${draftRevision} = ${revision}`,
        sql`jsonb_array_length(${videoTasks.draft}) > ${index}`,
        sql`jsonb_array_length(${videoTasks.draft}) > 1`,
      ),
    )
    .returning({ id: videoTasks.id });
  if (rows.length > 0) return "saved";
  const [row] = await database
    .select({ count: sql<number>`jsonb_array_length(${videoTasks.draft})`, revision: draftRevision })
    .from(videoTasks)
    .where(and(videoRow(teacherId, materialId), isNotNull(videoTasks.draft)));
  if (row && row.revision === revision && row.count === 1) return "last";
  return refused(database, teacherId, materialId);
}

/**
 * «Подтвердить»: the draft, as the teacher's page showed it, becomes the
 * video's tasks. One conditional write: a draft the assistant replaced
 * meanwhile is a conflict, never confirmed unseen.
 */
export async function confirmVideoTasks(database: Database, teacherId: string, materialId: string, revision: string): Promise<ChangedTasks> {
  const rows = await database
    .update(videoTasks)
    .set({ tasks: sql`${videoTasks.draft}`, confirmedAt: sql`now()`, draft: null, draftEditedAt: null, updatedAt: sql`now()` })
    .where(and(videoRow(teacherId, materialId), isNotNull(videoTasks.draft), sql`${draftRevision} = ${revision}`))
    .returning({ id: videoTasks.id });
  return rows.length > 0 ? "saved" : refused(database, teacherId, materialId);
}
