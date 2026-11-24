// The workbook task bank (#224): a textbook lesson's tasks, checked once and
// picked from at every preparation. The assistant saves a lesson's tasks as a
// draft; the teacher removes what she does not want and confirms the lesson,
// one lesson at a time. A save after confirmation lies beside the confirmed
// tasks and replaces them only when she confirms again. Tasks are kept in the
// homework format with their pictures and recordings in the blob store, as a
// homework keeps them. The teacher's only: no student, parent or link
// procedure reads this module.
import { and, eq, isNotNull, sql } from "drizzle-orm";
import {
  HOMEWORK_FORMAT_VERSION,
  imageRef,
  partPictures,
  type StudentTask,
  studentView,
  type Task,
  validateHomework,
  withPartPictures,
} from "../../domain/homework-format";
import { type BankList, bankFileUrl, type BookSource, MAX_LESSON_TASKS, type SkippedExercise, skippedSchema } from "../../domain/task-bank";
import type { TextbookStructure } from "../../domain/textbook-structure";
import { teacherIdFromHeaders } from "../access/auth";
import { readBlob } from "../blob/store";
import { type Database, db } from "../db/client";
import { textbook, textbookLessonTasks } from "../db/schema";
import { storeTaskFiles, taskFileRefs, taskFileResponse } from "../homework/images";
import { findLesson } from "./textbook-structure";

type Saved = "saved" | "not_found" | { errors: string[] };

/** Checks the assistant's tasks and skipped exercises: the homework format, a book source on every task. */
function checkLessonTasks(tasks: unknown, skipped: unknown): { ok: true; tasks: Task[]; skipped: SkippedExercise[] } | { ok: false; errors: string[] } {
  if (!Array.isArray(tasks)) return { ok: false, errors: ["tasks: нужен список заданий"] };
  if (tasks.length > MAX_LESSON_TASKS) return { ok: false, errors: [`tasks: не больше ${MAX_LESSON_TASKS} заданий в уроке`] };
  const errors: string[] = [];
  let checked: Task[] = [];
  if (tasks.length > 0) {
    const parsed = validateHomework({ version: HOMEWORK_FORMAT_VERSION, title: "Задания урока", tasks });
    if (!parsed.ok) errors.push(...parsed.errors);
    else checked = parsed.homework.tasks;
  }
  for (const [index, task] of checked.entries()) {
    if (typeof task.source !== "object") errors.push(`Задание ${index + 1}, поле source: укажите книгу, страницу и упражнение`);
    // A video goes into homework from the library (#330), not through the bank.
    if (task.video) errors.push(`Задание ${index + 1}, поле video: в заданиях учебника видео не указывается`);
  }
  const skips = skippedSchema.safeParse(skipped);
  if (!skips.success) errors.push(...skips.error.issues.slice(0, 5).map((issue) => `skipped.${issue.path.join(".")}: ${issue.message}`));
  if (errors.length > 0 || !skips.success) return { ok: false, errors: errors.slice(0, 10) };
  return { ok: true, tasks: checked, skipped: skips.data };
}

/**
 * The assistant's tasks for one lesson of the textbook's confirmed structure,
 * saved as the lesson's draft. It replaces the previous draft; the confirmed
 * tasks stay until the teacher confirms the new one.
 */
export async function saveAssistantLessonTasks(
  database: Database,
  teacherId: string,
  textbookId: string,
  lessonId: string,
  tasks: unknown,
  skipped: unknown,
): Promise<Saved> {
  if (!(await findLesson(database, teacherId, textbookId, lessonId))) return "not_found";
  const checked = checkLessonTasks(tasks, skipped);
  if (!checked.ok) return { errors: checked.errors };
  let stored: Task[] = [];
  if (checked.tasks.length > 0) {
    const files = await storeTaskFiles(database, teacherId, { version: HOMEWORK_FORMAT_VERSION, title: "Задания урока", tasks: checked.tasks }, new Set());
    if (!files.ok) return { errors: files.errors };
    stored = files.homework.tasks;
  }
  await database
    .insert(textbookLessonTasks)
    .values({ teacherId, textbookId, lessonId, draft: stored, draftSkipped: checked.skipped })
    .onConflictDoUpdate({
      target: [textbookLessonTasks.textbookId, textbookLessonTasks.lessonId],
      set: { draft: stored, draftSkipped: checked.skipped, updatedAt: sql`now()` },
      // A lesson is one teacher's, as its textbook is; the row never changes hands.
      setWhere: eq(textbookLessonTasks.teacherId, teacherId),
    });
  return "saved";
}

/** A task as the child will see it, without the keys, with its source and its files' addresses. */
export type BankTaskView = { task: StudentTask; source: BookSource | null };

export type BankLessonView = {
  lessonId: string;
  unit: string;
  title: string;
  /** The confirmed tasks, or null before the first confirmation. */
  confirmed: { tasks: BankTaskView[]; skipped: SkippedExercise[] } | null;
  draft: { tasks: BankTaskView[]; skipped: SkippedExercise[]; revision: string } | null;
};

/** The draft as the teacher's page loaded it: removing and confirming are refused once a new save replaced it. */
const draftRevision = sql<string>`md5(coalesce(${textbookLessonTasks.draft}::text, '') || coalesce(${textbookLessonTasks.draftSkipped}::text, ''))`;

/** Tasks as the child will see them, their files at the bank's addresses. */
export function bankTaskViews(entryId: string, list: BankList, tasks: Task[]): BankTaskView[] {
  return tasks.map((task, index) => ({
    task: {
      ...withPartPictures(studentView(task, `${entryId}:${list}:${index}`), (_, n) => bankFileUrl(entryId, list, index, { picture: n })),
      ...(task.image ? { image: bankFileUrl(entryId, list, index) } : {}),
      ...(task.audio ? { audio: bankFileUrl(entryId, list, index, "audio") } : {}),
    },
    source: typeof task.source === "object" ? task.source : null,
  }));
}

/** Every lesson of the textbook's confirmed structure with its tasks, or null when the textbook is not this teacher's. */
export async function readTaskBank(database: Database, teacherId: string, textbookId: string): Promise<BankLessonView[] | null> {
  const [book] = await database
    .select({ structure: textbook.structure })
    .from(textbook)
    .where(and(eq(textbook.id, textbookId), eq(textbook.teacherId, teacherId)));
  if (!book) return null;
  const rows = await database
    .select({
      id: textbookLessonTasks.id,
      lessonId: textbookLessonTasks.lessonId,
      tasks: textbookLessonTasks.tasks,
      skipped: textbookLessonTasks.skipped,
      draft: textbookLessonTasks.draft,
      draftSkipped: textbookLessonTasks.draftSkipped,
      revision: draftRevision,
    })
    .from(textbookLessonTasks)
    .where(and(eq(textbookLessonTasks.textbookId, textbookId), eq(textbookLessonTasks.teacherId, teacherId)));
  const byLesson = new Map(rows.map((row) => [row.lessonId, row]));
  // A lesson the structure no longer has keeps its row, unseen, until a structure brings the lesson back.
  const structure = book.structure as TextbookStructure | null;
  return (structure?.units ?? []).flatMap((unit) =>
    unit.lessons.map((lesson) => {
      const row = lesson.id ? byLesson.get(lesson.id) : undefined;
      return {
        lessonId: lesson.id!,
        unit: unit.title,
        title: lesson.title,
        confirmed: row?.tasks ? { tasks: bankTaskViews(row.id, "tasks", row.tasks as Task[]), skipped: (row.skipped as SkippedExercise[] | null) ?? [] } : null,
        draft: row?.draft
          ? { tasks: bankTaskViews(row.id, "draft", row.draft as Task[]), skipped: (row.draftSkipped as SkippedExercise[] | null) ?? [], revision: row.revision }
          : null,
      };
    }),
  );
}

type Changed = "saved" | "not_found" | "conflict";

const lessonRow = (teacherId: string, textbookId: string, lessonId: string) =>
  and(eq(textbookLessonTasks.teacherId, teacherId), eq(textbookLessonTasks.textbookId, textbookId), eq(textbookLessonTasks.lessonId, lessonId));

/** "conflict" when the lesson has a draft, "not_found" when it has none: what a refused conditional write meant. */
async function refused(database: Database, teacherId: string, textbookId: string, lessonId: string): Promise<Changed> {
  const [row] = await database
    .select({ id: textbookLessonTasks.id })
    .from(textbookLessonTasks)
    .where(and(lessonRow(teacherId, textbookId, lessonId), isNotNull(textbookLessonTasks.draft)));
  return row ? "conflict" : "not_found";
}

/** «Убрать»: takes one task out of the lesson's draft, as the teacher's page showed it (`revision`). */
export async function removeDraftTask(
  database: Database,
  teacherId: string,
  textbookId: string,
  lessonId: string,
  index: number,
  revision: string,
): Promise<Changed> {
  const rows = await database
    .update(textbookLessonTasks)
    .set({ draft: sql`${textbookLessonTasks.draft} - ${index}::int`, updatedAt: sql`now()` })
    .where(
      and(
        lessonRow(teacherId, textbookId, lessonId),
        sql`${draftRevision} = ${revision}`,
        sql`jsonb_array_length(${textbookLessonTasks.draft}) > ${index}`,
      ),
    )
    .returning({ id: textbookLessonTasks.id });
  return rows.length > 0 ? "saved" : refused(database, teacherId, textbookId, lessonId);
}

/**
 * «Подтвердить урок»: the draft, as the teacher's page showed it, becomes the
 * lesson's tasks. One conditional write: a draft the assistant replaced
 * meanwhile is a conflict, never confirmed unseen.
 */
export async function confirmLessonTasks(
  database: Database,
  teacherId: string,
  textbookId: string,
  lessonId: string,
  revision: string,
): Promise<Changed> {
  const rows = await database
    .update(textbookLessonTasks)
    .set({
      tasks: sql`${textbookLessonTasks.draft}`,
      skipped: sql`${textbookLessonTasks.draftSkipped}`,
      confirmedAt: sql`now()`,
      draft: null,
      draftSkipped: null,
      updatedAt: sql`now()`,
    })
    .where(and(lessonRow(teacherId, textbookId, lessonId), isNotNull(textbookLessonTasks.draft), sql`${draftRevision} = ${revision}`))
    .returning({ id: textbookLessonTasks.id });
  return rows.length > 0 ? "saved" : refused(database, teacherId, textbookId, lessonId);
}

/** The confirmed tasks as the teacher's editor saw them: an edit is refused once they changed. */
/** The confirmed tasks as a page or a plan saw them (#225, #329). */
export const tasksRevision = sql<string>`md5(coalesce(${textbookLessonTasks.tasks}::text, ''))`;

/** A confirmed lesson's tasks whole, keys included, for the teacher's editor (#225); null when the lesson has none confirmed. */
export async function readConfirmedTasks(
  database: Database,
  teacherId: string,
  textbookId: string,
  lessonId: string,
): Promise<{ entryId: string; tasks: Task[]; revision: string } | null> {
  const [row] = await database
    .select({ id: textbookLessonTasks.id, tasks: textbookLessonTasks.tasks, revision: tasksRevision })
    .from(textbookLessonTasks)
    .where(and(lessonRow(teacherId, textbookId, lessonId), isNotNull(textbookLessonTasks.tasks)));
  return row ? { entryId: row.id, tasks: row.tasks as Task[], revision: row.revision } : null;
}

/**
 * Saves one confirmed task as the teacher edited it (#225), checked against
 * the format with a book source. New pictures come as data URLs; a stored
 * one may stay only if the lesson's confirmed tasks already have it. One
 * conditional write: the tasks must be those her editor loaded (`revision`).
 * A homework built from the bank before keeps its own copy.
 */
export async function updateConfirmedTask(
  database: Database,
  teacherId: string,
  textbookId: string,
  lessonId: string,
  index: number,
  revision: string,
  input: unknown,
): Promise<"saved" | "not_found" | "conflict" | { errors: string[] }> {
  const current = await readConfirmedTasks(database, teacherId, textbookId, lessonId);
  if (!current || index >= current.tasks.length) return "not_found";
  if (current.revision !== revision) return "conflict";
  const checked = checkLessonTasks([input], []);
  // The editor saves one task; the problems name it by its place in the lesson.
  if (!checked.ok) return { errors: checked.errors.map((line) => line.replace(/^Задание 1\b/, `Задание ${index + 1}`)) };
  const keep = taskFileRefs({ version: HOMEWORK_FORMAT_VERSION, title: "Задания урока", tasks: current.tasks });
  const files = await storeTaskFiles(database, teacherId, { version: HOMEWORK_FORMAT_VERSION, title: "Задания урока", tasks: checked.tasks }, keep);
  if (!files.ok) return { errors: files.errors };
  const rows = await database
    .update(textbookLessonTasks)
    .set({
      tasks: sql`jsonb_set(${textbookLessonTasks.tasks}, ${`{${index}}`}::text[], ${JSON.stringify(files.homework.tasks[0])}::jsonb)`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(textbookLessonTasks.id, current.entryId), eq(textbookLessonTasks.teacherId, teacherId), sql`${tasksRevision} = ${revision}`))
    .returning({ id: textbookLessonTasks.id });
  return rows.length > 0 ? "saved" : "conflict";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INDEX = /^(0|[1-9]\d{0,2})$/;
const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/**
 * Serves a bank task's picture, recording or part picture to the teacher
 * whose bank it is. No session, another teacher's bank, a student's or a
 * parent's session and a missing task all answer the same 404.
 */
export async function handleBankFileRequest(
  request: Request,
  entryId: string,
  list: string,
  taskIndex: string,
  part: "image" | "audio" | { picture: string } = "image",
): Promise<Response> {
  if (!UUID.test(entryId) || (list !== "tasks" && list !== "draft") || !INDEX.test(taskIndex)) return notFound();
  if (typeof part === "object" && !INDEX.test(part.picture)) return notFound();
  const teacherId = await teacherIdFromHeaders(request.headers);
  if (!teacherId) return notFound();
  const database = db();
  const [row] = await database
    .select({ tasks: list === "tasks" ? textbookLessonTasks.tasks : textbookLessonTasks.draft })
    .from(textbookLessonTasks)
    .where(and(eq(textbookLessonTasks.id, entryId), eq(textbookLessonTasks.teacherId, teacherId)));
  const task = (row?.tasks as Task[] | null | undefined)?.[Number(taskIndex)];
  const value = !task ? undefined : typeof part === "object" ? partPictures(task)[Number(part.picture)]?.value : task[part];
  const ref = value ? imageRef(value) : null;
  const file = ref ? await readBlob(database, teacherId, ref) : null;
  if (!file || !ref) return notFound();
  return taskFileResponse(request, ref, file, part === "audio");
}
