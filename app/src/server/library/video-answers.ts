// The student answers a library video's tasks under it (#327): the
// confirmed tasks (#326) of a video the teacher opened to them, during the
// lesson and an hour after (#158). One attempt per video and lesson, then
// praise only — no score, nothing right or wrong (#227; product owner,
// 2026-11-23). The answers are checked on the server; the wrong ones join
// «Ошибки по темам» as «Видео: <title>». Keys never go out: the tasks leave
// as studentView(), the verdicts stay here (AGENTS.md, rule 4).
import { createHash, createHmac } from "node:crypto";
import { and, eq, gt, gte, sql } from "drizzle-orm";
import { answerText } from "../../domain/homework";
import { type Answer, type StudentTask, studentView, type Task } from "../../domain/homework-format";
import type { Database } from "../db/client";
import { gameAccess, libraryMaterial, videoAnswer, videoTasks } from "../db/schema";
import { env } from "../env";
import { checkAnswer, fitsTask } from "../homework/check";
import { openTextbookVideoFor } from "./textbook-videos";

/** Tasks the platform checks itself; a written answer waits for the teacher, as in homework. */
const verdictOf = (task: Task, answer: Answer | null): boolean | null =>
  task.type === "written" || task.type === "voice" || task.type === "file" ? null : answer !== null && checkAnswer(task, answer);

/** The confirmed tasks' text hashed: a new confirmation changes it. Never sent as is: it is unkeyed, and the tasks hold their keys. */
const tasksHash = sql<string>`md5(coalesce(${videoTasks.tasks}::text, ''))`;

/**
 * The revision a student's page gets for the confirmed tasks: an HMAC of
 * their hash with the link key, so the keys cannot be found offline by
 * hashing guesses (AGENTS.md, rule 4).
 */
export function videoTasksRevision(materialId: string, hash: string): string {
  return createHmac("sha256", env().LINK_KEY).update(`video-tasks|${materialId}|${hash}`).digest("base64url");
}

/** The seed of a task's shuffled options, derived from a secret as for homework (`shuffleSeed`). */
export function videoShuffleSeed(materialId: string, studentId: string, taskIndex: number): string {
  return createHmac("sha256", env().LINK_KEY).update(`video-shuffle|${materialId}|${studentId}|${taskIndex}`).digest("base64url");
}

/** The video open to this student at `now` with its confirmed tasks and the lesson it was opened in; null when it is not open. */
async function openVideo(database: Database, teacherId: string, studentId: string, materialId: string, now: Date) {
  const [row] = await database
    .select({ title: libraryMaterial.title, lessonId: gameAccess.lessonId, tasks: videoTasks.tasks, hash: tasksHash })
    .from(gameAccess)
    .innerJoin(libraryMaterial, and(eq(libraryMaterial.id, gameAccess.materialId), eq(libraryMaterial.teacherId, teacherId), eq(libraryMaterial.kind, "video")))
    .leftJoin(videoTasks, and(eq(videoTasks.materialId, libraryMaterial.id), eq(videoTasks.teacherId, teacherId)))
    .where(and(eq(gameAccess.teacherId, teacherId), eq(gameAccess.studentId, studentId), eq(gameAccess.materialId, materialId), gt(gameAccess.until, now)));
  if (row) return { title: row.title, lessonId: row.lessonId, tasks: (row.tasks as Task[] | null) ?? null, revision: videoTasksRevision(materialId, row.hash) };
  // A textbook video opened from a lesson's preparation (#329), with the tasks copied when it was opened.
  const textbook = await openTextbookVideoFor(database, teacherId, studentId, materialId, now);
  if (!textbook) return null;
  const hash = createHash("md5").update(JSON.stringify(textbook.tasks)).digest("hex");
  return { title: textbook.title, lessonId: textbook.lessonId, tasks: textbook.tasks, revision: videoTasksRevision(materialId, hash) };
}

export type StudentVideoTasks = { tasks: StudentTask[]; revision: string; done: boolean };

/**
 * The confirmed tasks under an open video as the child sees them, and whether
 * they were answered in this lesson, with the revision «Готово» sends back; null when the video has no confirmed
 * tasks or is not open to this student.
 */
export async function studentVideoTasks(database: Database, teacherId: string, studentId: string, materialId: string, now: Date = new Date()): Promise<StudentVideoTasks | null> {
  const video = await openVideo(database, teacherId, studentId, materialId, now);
  if (!video?.tasks?.length) return null;
  const [answered] = await database
    .select({ id: videoAnswer.id })
    .from(videoAnswer)
    .where(and(eq(videoAnswer.materialId, materialId), eq(videoAnswer.studentId, studentId), eq(videoAnswer.lessonId, video.lessonId)));
  return {
    tasks: video.tasks.map((task, index) => studentView(task, videoShuffleSeed(materialId, studentId, index))),
    revision: video.revision,
    done: answered !== undefined,
  };
}

/**
 * «Готово»: the answers, one per task in order (null for none), checked and
 * kept once per video and lesson — the unique index keeps a second attempt
 * out. They are checked against the tasks the page showed (`revision`): the
 * tasks read here are the ones kept with the answers, and "changed" when the
 * teacher confirmed others meanwhile. "not_found" when the video is not open
 * or has no tasks, "invalid" for an answer that does not fit its task,
 * "done" when already answered.
 */
export async function submitVideoAnswers(
  database: Database,
  teacherId: string,
  studentId: string,
  materialId: string,
  revision: string,
  answers: (Answer | null)[],
  now: Date = new Date(),
): Promise<"saved" | "done" | "changed" | "not_found" | "invalid"> {
  const video = await openVideo(database, teacherId, studentId, materialId, now);
  if (!video?.tasks?.length) return "not_found";
  if (video.revision !== revision) return "changed";
  const { tasks } = video;
  if (answers.length !== tasks.length || answers.some((answer, i) => answer !== null && !fitsTask(tasks[i]!, answer))) return "invalid";
  const rows = await database
    .insert(videoAnswer)
    .values({
      teacherId,
      studentId,
      materialId,
      lessonId: video.lessonId,
      title: video.title,
      tasks,
      answers,
      verdicts: tasks.map((task, i) => verdictOf(task, answers[i] ?? null)),
      submittedAt: now,
    })
    .onConflictDoNothing({ target: [videoAnswer.materialId, videoAnswer.studentId, videoAnswer.lessonId] })
    .returning({ id: videoAnswer.id });
  return rows.length > 0 ? "saved" : "done";
}

export type VideoMistake = { topic: string | null; task: string; answer: string | null; title: string; at: Date };

/** The student's wrong answers to videos' tasks since a moment, for «Ошибки по темам» (#119). */
export async function videoMistakes(database: Database, teacherId: string, studentId: string, since: Date): Promise<VideoMistake[]> {
  const rows = await database
    .select({ title: videoAnswer.title, tasks: videoAnswer.tasks, answers: videoAnswer.answers, verdicts: videoAnswer.verdicts, at: videoAnswer.submittedAt })
    .from(videoAnswer)
    .where(and(eq(videoAnswer.teacherId, teacherId), eq(videoAnswer.studentId, studentId), gte(videoAnswer.submittedAt, since)));
  return rows.flatMap((row) => {
    const tasks = row.tasks as Task[];
    const answers = row.answers as (Answer | null)[];
    const verdicts = row.verdicts as (boolean | null)[];
    return tasks.flatMap((task, i) =>
      verdicts[i] === false ? [{ topic: task.topic ?? null, task: task.prompt, answer: answerText(task, answers[i] ?? null), title: row.title, at: row.at }] : [],
    );
  });
}
