// Videos of a textbook set (#329). The teacher uploads them with the set and
// marks which lesson each belongs to in the structure, by name as tracks. A
// lesson's preparation offers them as a «Видео» stage, with tasks picked from
// the lesson's bank (#224). From the preparation she opens one to the
// student (product owner, 2026-11-23): at once, until an hour after that
// lesson's end, with the picked tasks copied as they are then. The student
// watches it among the lesson's videos and answers its tasks as under a
// library video (#327); the answers go to `video_answer` under the file's id.
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import type { Task } from "../../domain/homework-format";
import type { LessonPlan } from "../../domain/lesson-plan";
import type { TextbookStructure } from "../../domain/textbook-structure";
import type { Database } from "../db/client";
import { lesson, lessonPlan, textbookFile, textbookLessonTasks, textbookVideoAccess } from "../db/schema";

/** A video of a textbook lesson, with the confirmed tasks of the lesson's bank it may take. */
export type TextbookLessonVideo = { fileId: string; name: string; lessonId: string; lessonTitle: string; tasks: Task[] };

/** The access lasts until an hour after the lesson's end, as a library video opened in a lesson does (#158). */
const AFTER_LESSON_MS = 60 * 60_000;

/** The videos the structure's lessons have, each with its lesson's confirmed bank tasks; a name without a file is left out. */
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
    .select({ lessonId: textbookLessonTasks.lessonId, tasks: textbookLessonTasks.tasks })
    .from(textbookLessonTasks)
    .where(and(eq(textbookLessonTasks.textbookId, textbookId), inArray(textbookLessonTasks.lessonId, [...new Set(marked.map((m) => m.lessonId))])));
  const bankOf = new Map(banks.map((b) => [b.lessonId, (b.tasks as Task[] | null) ?? []]));
  return marked.map((m) => ({ ...m, tasks: bankOf.get(m.lessonId) ?? [] }));
}

/**
 * «Открыть ученику» on a video stage of the lesson's saved plan: the stage's
 * tasks copied from the bank, open from now until an hour after the lesson's
 * end. "not_found" when the lesson is not this teacher's lesson still to hold,
 * or its saved plan has no stage with this video of the student's textbook.
 */
export async function openTextbookVideo(
  database: Database,
  teacherId: string,
  lessonId: string,
  fileId: string,
  textbook: { id: string; structure: TextbookStructure | null } | null,
): Promise<"opened" | "not_found"> {
  const [row] = await database
    .select({ studentId: lesson.studentId, startsAt: lesson.startsAt, minutes: lesson.durationMinutes, plan: lessonPlan.plan })
    .from(lesson)
    .innerJoin(lessonPlan, eq(lessonPlan.lessonId, lesson.id))
    .where(and(eq(lesson.id, lessonId), eq(lesson.teacherId, teacherId), eq(lesson.status, "scheduled")));
  if (!row || !textbook) return "not_found";
  const stage = ((row.plan as LessonPlan | null)?.stages ?? []).find((s) => s.type === "textbook_video" && s.fileId === fileId);
  if (!stage || stage.type !== "textbook_video") return "not_found";
  const video = (await textbookLessonVideos(database, textbook.id, textbook.structure)).find((v) => v.fileId === fileId && v.lessonId === stage.lessonId);
  if (!video) return "not_found";
  const tasks = stage.tasks.flatMap((i) => (video.tasks[i] ? [video.tasks[i]] : []));
  const until = new Date(row.startsAt.getTime() + row.minutes * 60_000 + AFTER_LESSON_MS);
  await database
    .insert(textbookVideoAccess)
    .values({ teacherId, studentId: row.studentId, fileId, lessonId, tasks, until })
    .onConflictDoUpdate({
      target: [textbookVideoAccess.lessonId, textbookVideoAccess.fileId],
      set: { tasks, until, updatedAt: new Date() },
      setWhere: eq(textbookVideoAccess.teacherId, teacherId),
    });
  return "opened";
}

/** The videos of the plan opened to the student from this lesson's preparation, by file. */
export async function openedFromLesson(database: Pick<Database, "select">, teacherId: string, lessonId: string, now: Date = new Date()): Promise<Set<string>> {
  const rows = await database
    .select({ fileId: textbookVideoAccess.fileId })
    .from(textbookVideoAccess)
    .where(and(eq(textbookVideoAccess.teacherId, teacherId), eq(textbookVideoAccess.lessonId, lessonId), gt(textbookVideoAccess.until, now)));
  return new Set(rows.map((r) => r.fileId));
}

export type OpenTextbookVideo = { id: string; title: string; lessonId: string; tasks: Task[] };

/** The textbook videos open to this student at `now`, the latest opening of each, by name. */
export async function openTextbookVideos(database: Pick<Database, "select">, teacherId: string, studentId: string, now: Date = new Date()): Promise<OpenTextbookVideo[]> {
  const rows = await database
    .select({ id: textbookVideoAccess.fileId, title: textbookFile.name, lessonId: textbookVideoAccess.lessonId, tasks: textbookVideoAccess.tasks })
    .from(textbookVideoAccess)
    .innerJoin(textbookFile, eq(textbookFile.id, textbookVideoAccess.fileId))
    .where(and(eq(textbookVideoAccess.teacherId, teacherId), eq(textbookVideoAccess.studentId, studentId), gt(textbookVideoAccess.until, now)))
    .orderBy(desc(textbookVideoAccess.until));
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
