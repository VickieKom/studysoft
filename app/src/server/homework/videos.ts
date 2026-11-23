// A video in homework (#330). A task may be about a video — a library video
// of the teacher's, by its id, or a link — and the student sees it above the
// task. «Добавить видео» in a draft copies a library video's confirmed tasks
// (#326) into the homework, each carrying the video: copied, not linked, so
// they are edited and removed like the rest, and a later change of the
// video's tasks leaves the homework as it was (product owner, 2026-11-23).
// A library video's own file is served to a student whose published homework
// is about it, as to one it is open to in a lesson (#158).
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { HomeworkDocument, StudentTaskVideo, Task } from "../../domain/homework-format";
import { youTubeEmbedUrl } from "../../domain/library";
import type { Database } from "../db/client";
import { homework, libraryMaterial, videoTasks } from "../db/schema";

type LibraryVideo = { id: string; title: string; hasFile: boolean; url: string | null };

/** The teacher's library videos among `ids`, not drafts, by id. */
async function libraryVideos(database: Pick<Database, "select">, teacherId: string, ids: string[]): Promise<Map<string, LibraryVideo>> {
  if (ids.length === 0) return new Map();
  const rows = await database
    .select({ id: libraryMaterial.id, title: libraryMaterial.title, blobId: libraryMaterial.blobId, url: libraryMaterial.url })
    .from(libraryMaterial)
    .where(
      and(
        eq(libraryMaterial.teacherId, teacherId),
        eq(libraryMaterial.kind, "video"),
        eq(libraryMaterial.draft, false),
        inArray(libraryMaterial.id, ids),
      ),
    );
  return new Map(rows.map((r) => [r.id, { id: r.id, title: r.title, hasFile: r.blobId !== null, url: r.url }]));
}

const libraryIds = (tasks: Task[]) => [...new Set(tasks.flatMap((t) => (t.video && "library" in t.video ? [t.video.library.toLowerCase()] : [])))];

/**
 * The errors of a homework whose tasks name a library video the teacher has
 * not (another teacher's, a draft, a game, none at all); empty when there is
 * none. Checked wherever a homework is saved: import, the editor, the assistant.
 */
export async function taskVideoErrors(database: Pick<Database, "select">, teacherId: string, document: HomeworkDocument): Promise<string[]> {
  const known = await libraryVideos(database, teacherId, libraryIds(document.tasks));
  return document.tasks.flatMap((task, index) =>
    task.video && "library" in task.video && !known.has(task.video.library.toLowerCase())
      ? [`Задание ${index + 1}, поле video: в библиотеке нет такого видео`]
      : [],
  );
}

/** What the student gets of a link: YouTube as its embedded player (#325), anything else to open in a new tab. */
function ofLink(title: string, url: string): StudentTaskVideo {
  const embed = youTubeEmbedUrl(url);
  return embed ? { title, embed } : { title, link: url };
}

/** A library video as it plays: its own file, or its link. */
function ofLibrary(video: LibraryVideo): StudentTaskVideo | undefined {
  if (video.hasFile) return { title: video.title, file: `/api/files/library/${video.id}` };
  return video.url ? ofLink(video.title, video.url) : undefined;
}

/** A task's video as it plays, from the library videos it may name. */
function played(task: Task, known: Map<string, LibraryVideo>): StudentTaskVideo | undefined {
  if (!task.video) return undefined;
  if ("url" in task.video) return ofLink("Видео", task.video.url);
  const video = known.get(task.video.library.toLowerCase());
  return video ? ofLibrary(video) : undefined;
}

/**
 * The tasks' videos as the student gets them, one per task (undefined for a
 * task about none, or about a library video no longer there). The teacher's
 * draft shows them the same way.
 */
export async function studentTaskVideos(database: Pick<Database, "select">, teacherId: string, tasks: Task[]): Promise<(StudentTaskVideo | undefined)[]> {
  const known = await libraryVideos(database, teacherId, libraryIds(tasks));
  return tasks.map((task) => played(task, known));
}

/** «Видео из библиотеки» in a draft: the teacher's videos with confirmed tasks, by title, each as it plays. */
export async function videosToAdd(database: Database, teacherId: string): Promise<{ id: string; title: string; video: StudentTaskVideo | null }[]> {
  const rows = await database
    .select({ id: libraryMaterial.id, title: libraryMaterial.title, blobId: libraryMaterial.blobId, url: libraryMaterial.url })
    .from(libraryMaterial)
    .innerJoin(videoTasks, and(eq(videoTasks.materialId, libraryMaterial.id), eq(videoTasks.teacherId, teacherId)))
    .where(and(eq(libraryMaterial.teacherId, teacherId), eq(libraryMaterial.kind, "video"), eq(libraryMaterial.draft, false), isNotNull(videoTasks.tasks)))
    .orderBy(libraryMaterial.title);
  return rows.map((r) => ({ id: r.id, title: r.title, video: ofLibrary({ id: r.id, title: r.title, hasFile: r.blobId !== null, url: r.url }) ?? null }));
}

/**
 * «Добавить в домашку»: copies of the video's confirmed tasks, each carrying
 * the video, for the editor to append and save; null when the teacher has no
 * such video or it has no confirmed tasks.
 */
export async function videoTasksForHomework(database: Database, teacherId: string, materialId: string): Promise<Task[] | null> {
  const [row] = await database
    .select({ tasks: videoTasks.tasks })
    .from(videoTasks)
    .innerJoin(libraryMaterial, and(eq(libraryMaterial.id, videoTasks.materialId), eq(libraryMaterial.teacherId, teacherId), eq(libraryMaterial.draft, false)))
    .where(and(eq(videoTasks.teacherId, teacherId), eq(videoTasks.materialId, materialId)));
  const tasks = (row?.tasks as Task[] | null | undefined) ?? null;
  if (!tasks?.length) return null;
  return tasks.map((task) => ({ ...task, video: { library: materialId } }));
}

/** Whether a published homework of this student is about the library video `id`: its file is then theirs to watch. */
export async function isInStudentHomework(database: Pick<Database, "select">, teacherId: string, studentId: string, id: string): Promise<boolean> {
  const [row] = await database
    .select({ id: homework.id })
    .from(homework)
    .where(
      and(
        eq(homework.teacherId, teacherId),
        eq(homework.studentId, studentId),
        eq(homework.status, "published"),
        sql`${homework.document}->'tasks' @> ${JSON.stringify([{ video: { library: id } }])}::jsonb`,
      ),
    )
    .limit(1);
  return row !== undefined;
}
