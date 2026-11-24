// Videos of a textbook set (#329). The teacher uploads them with the set and
// marks which lesson each belongs to in the structure, by name as tracks. A
// lesson's preparation offers them as a «Видео» stage, with tasks picked from
// the lesson's bank (#224). From the preparation she opens one to the
// student (product owner, 2026-11-23): at once, until an hour after that
// lesson's end — read from the lesson, so moving or cancelling it moves or
// ends the access — with the picked tasks copied as they are then. The student
// watches it among the lesson's videos and answers its tasks as under a
// library video (#327); the answers go to `video_answer` under the file's id.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Task } from "../../domain/homework-format";
import type { LessonPlan } from "../../domain/lesson-plan";
import type { TextbookStructure } from "../../domain/textbook-structure";
import type { Database } from "../db/client";
import { lesson, lessonPlan, textbookFile, textbookLessonTasks, textbookVideoAccess } from "../db/schema";
import { tasksRevision } from "./task-bank";
import { videoTaskError } from "./video-tasks";

/**
 * A video of a textbook lesson, with the confirmed tasks of the lesson's bank
 * that can go under a video (text only, answered in text, as a library
 * video's, #326) by their position in the bank, and the bank's revision the
 * positions belong to.
 */
export type TextbookLessonVideo = { fileId: string; name: string; lessonId: string; lessonTitle: string; tasks: { index: number; task: Task }[]; revision: string };

/**
 * Open from the opening until an hour after the lesson's end, as a library
 * video opened in a lesson is (#158), and only while the lesson is not
 * cancelled or missed. Read from the lesson each time, so a moved lesson
 * moves the access and a cancelled one ends it.
 */
const stillOpen = (now: Date) =>
  and(
    sql`${lesson.status} NOT IN ('cancelled', 'missed')`,
    sql`${lesson.startsAt} + ${lesson.durationMinutes} * interval '1 minute' + interval '1 hour' > ${now.toISOString()}`,
  );

/** The videos the structure's lessons have, each with its lesson's confirmed bank tasks fit for a video; a name without a file is left out. */
export async function textbookLessonVideos(
  database: Pick<Database, "select">,
  textbookId: string,
  structure: TextbookStructure | null,
): Promise<TextbookLessonVideo[]> {
  if (!structure) return [];
  const files = await database
    .select({ id: textbookFile.id, name: textbookFile.name })
    .from(textbookFile)
    .where(and(eq(textbookFile.textbookId, textbookId), eq(textbookFile.kind, "video")));
  const byName = new Map(files.map((f) => [f.name, f.id]));
  const marked = structure.units.flatMap((u) =>
    u.lessons.flatMap((l) => (l.videos ?? []).flatMap((name) => (byName.has(name) && l.id ? [{ fileId: byName.get(name)!, name, lessonId: l.id, lessonTitle: l.title }] : []))),
  );
  if (marked.length === 0) return [];
  const banks = await database
    .select({ lessonId: textbookLessonTasks.lessonId, tasks: textbookLessonTasks.tasks, revision: tasksRevision })
    .from(textbookLessonTasks)
    .where(and(eq(textbookLessonTasks.textbookId, textbookId), inArray(textbookLessonTasks.lessonId, [...new Set(marked.map((m) => m.lessonId))])));
  const bankOf = new Map(banks.map((b) => [b.lessonId, { tasks: (b.tasks as Task[] | null) ?? [], revision: b.revision }]));
  return marked.map((m) => {
    const bank = bankOf.get(m.lessonId);
    const tasks = (bank?.tasks ?? []).flatMap((task, index) => (videoTaskError(task) === null ? [{ index, task }] : []));
    return { ...m, tasks, revision: bank?.revision ?? EMPTY_BANK };
  });
}

/** The revision of a lesson with no bank row: what `tasksRevision` gives for no tasks. */
export const EMPTY_BANK = "d41d8cd98f00b204e9800998ecf8427e";

/**
 * Whether a plan's video stage still names what the bank has: the video of
 * that lesson, the bank as the plan saw it, and only tasks fit for a video.
 */
export function stageFits(video: TextbookLessonVideo | undefined, stage: { revision: string; tasks: number[] }): "fits" | "no_video" | "bank_changed" {
  if (!video) return "no_video";
  if (stage.revision !== video.revision) return "bank_changed";
  const fit = new Set(video.tasks.map((t) => t.index));
  return stage.tasks.every((i) => fit.has(i)) ? "fits" : "bank_changed";
}

/**
 * «Открыть ученику» on a video stage of the lesson's saved plan: the stage's
 * tasks copied from the bank, open from now until an hour after the lesson's
 * end. "not_found" when the lesson is not this teacher's lesson still to hold
 * or already over, or its saved plan has no stage with this video of the
 * student's textbook; "bank_changed" when the lesson's bank changed since the
 * plan picked its tasks.
 */
export async function openTextbookVideo(
  database: Database,
  teacherId: string,
  lessonId: string,
  fileId: string,
  textbook: { id: string; structure: TextbookStructure | null } | null,
  now: Date = new Date(),
): Promise<"opened" | "not_found" | "bank_changed"> {
  const [row] = await database
    .select({ studentId: lesson.studentId, plan: lessonPlan.plan })
    .from(lesson)
    .innerJoin(lessonPlan, eq(lessonPlan.lessonId, lesson.id))
    .where(and(eq(lesson.id, lessonId), eq(lesson.teacherId, teacherId), eq(lesson.status, "scheduled"), stillOpen(now)));
  if (!row || !textbook) return "not_found";
  const stage = ((row.plan as LessonPlan | null)?.stages ?? []).find((s) => s.type === "textbook_video" && s.fileId === fileId);
  if (!stage || stage.type !== "textbook_video") return "not_found";
  const video = (await textbookLessonVideos(database, textbook.id, textbook.structure)).find((v) => v.fileId === fileId && v.lessonId === stage.lessonId);
  const fits = stageFits(video, stage);
  if (fits !== "fits") return fits === "no_video" ? "not_found" : "bank_changed";
  const byIndex = new Map(video!.tasks.map((t) => [t.index, t.task]));
  const tasks = stage.tasks.map((i) => byIndex.get(i)!);
  await database
    .insert(textbookVideoAccess)
    .values({ teacherId, studentId: row.studentId, fileId, lessonId, tasks })
    .onConflictDoUpdate({
      target: [textbookVideoAccess.lessonId, textbookVideoAccess.fileId],
      set: { tasks, updatedAt: new Date() },
      setWhere: eq(textbookVideoAccess.teacherId, teacherId),
    });
  return "opened";
}

/** The videos of the plan opened to the student from this lesson's preparation and still open, by file. */
export async function openedFromLesson(database: Pick<Database, "select">, teacherId: string, lessonId: string, now: Date = new Date()): Promise<Set<string>> {
  const rows = await database
    .select({ fileId: textbookVideoAccess.fileId })
    .from(textbookVideoAccess)
    .innerJoin(lesson, eq(lesson.id, textbookVideoAccess.lessonId))
    .where(and(eq(textbookVideoAccess.teacherId, teacherId), eq(textbookVideoAccess.lessonId, lessonId), stillOpen(now)));
  return new Set(rows.map((r) => r.fileId));
}

export type OpenTextbookVideo = { id: string; title: string; lessonId: string; tasks: Task[] };

/** The textbook videos open to this student at `now`, by name; a video open from two lessons is the one of the lesson that started last. */
export async function openTextbookVideos(database: Pick<Database, "select">, teacherId: string, studentId: string, now: Date = new Date()): Promise<OpenTextbookVideo[]> {
  const rows = await database
    .select({ id: textbookVideoAccess.fileId, title: textbookFile.name, lessonId: textbookVideoAccess.lessonId, tasks: textbookVideoAccess.tasks })
    .from(textbookVideoAccess)
    .innerJoin(textbookFile, eq(textbookFile.id, textbookVideoAccess.fileId))
    .innerJoin(lesson, eq(lesson.id, textbookVideoAccess.lessonId))
    .where(and(eq(textbookVideoAccess.teacherId, teacherId), eq(textbookVideoAccess.studentId, studentId), stillOpen(now)))
    .orderBy(desc(lesson.startsAt));
  const seen = new Set<string>();
  return rows
    .filter((r) => !seen.has(r.id) && seen.add(r.id))
    .map((r) => ({ id: r.id, title: r.title, lessonId: r.lessonId, tasks: r.tasks as Task[] }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** One textbook video open to this student at `now`, or null. */
export async function openTextbookVideoFor(database: Pick<Database, "select">, teacherId: string, studentId: string, fileId: string, now: Date = new Date()) {
  return (await openTextbookVideos(database, teacherId, studentId, now)).find((v) => v.id === fileId) ?? null;
}

/** Whether this textbook video is open to this student at `now`: its file is served to them. */
export async function isTextbookVideoOpen(database: Pick<Database, "select">, teacherId: string, studentId: string, fileId: string, now: Date = new Date()) {
  return (await openTextbookVideoFor(database, teacherId, studentId, fileId, now)) !== null;
}
