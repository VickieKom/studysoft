// Homework drafts and their publication (#32). The document is stored as
// imported and never changes after publishing. The teacher's preview shows it
// whole, keys included; a student only ever gets studentView() — without the
// keys (AGENTS.md, rule 4).
import { createHmac } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  type Answer,
  type HomeworkDocument,
  homeworkSchema,
  type StoredAnswer,
  type StudentAnswer,
  type StudentTask,
  storedAnswerSchema,
  studentView,
  type Task,
} from "../../domain/homework-format";
import type { Database } from "../db/client";
import { draftOrigin, homework, homeworkAnswer, homeworkSubmission, student } from "../db/schema";
import { env } from "../env";
import { answerFileUrl, homeworkImageUrl, todayIn } from "../../domain/homework";
import { checkAnswer, fitsTask } from "./check";

export const HOMEWORK_STATUSES = ["draft", "published", "submitted", "missed"] as const;
export type HomeworkStatus = (typeof HOMEWORK_STATUSES)[number];

export type HomeworkSummary = {
  id: string;
  title: string;
  status: HomeworkStatus;
  dueDate: string | null;
  taskCount: number;
  /** Saved by the assistant (#43), whether or not the teacher edited it since. */
  fromAssistant: boolean;
  createdAt: Date;
};

const summaryColumns = {
  id: homework.id,
  title: homework.title,
  status: homework.status,
  dueDate: homework.dueDate,
  document: homework.document,
  createdAt: homework.createdAt,
  originId: draftOrigin.id,
};

type Row = {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  document: unknown;
  createdAt: Date;
  originId: string | null;
};

function taskCount(document: unknown): number {
  return (document as HomeworkDocument).tasks.length;
}

function toSummary(row: Row): HomeworkSummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status as HomeworkStatus,
    dueDate: row.dueDate,
    taskCount: taskCount(row.document),
    fromAssistant: row.originId !== null,
    createdAt: row.createdAt,
  };
}

/** Saves an already validated document as a draft for one student of this teacher. */
export async function importDraft(
  db: Database,
  teacherId: string,
  studentId: string,
  document: HomeworkDocument,
): Promise<string> {
  const [row] = await db
    .insert(homework)
    .values({ teacherId, studentId, title: document.title, document: homeworkSchema.parse(document) })
    .returning({ id: homework.id });
  if (!row) throw new Error("importDraft: insert returned no row");
  return row.id;
}

/** The student's homework, newest first. */
export async function listHomework(db: Database, teacherId: string, studentId: string): Promise<HomeworkSummary[]> {
  const rows = await db
    .select(summaryColumns)
    .from(homework)
    .leftJoin(draftOrigin, eq(draftOrigin.homeworkId, homework.id))
    .where(and(eq(homework.teacherId, teacherId), eq(homework.studentId, studentId)))
    .orderBy(desc(homework.createdAt));
  return rows.map(toSummary);
}

/** One homework of this teacher for the preview: the tasks with their keys, for the teacher only. */
export async function findHomework(
  db: Database,
  teacherId: string,
  id: string,
): Promise<(HomeworkSummary & { studentId: string; tasks: Task[] }) | null> {
  const [row] = await db
    .select({ ...summaryColumns, studentId: homework.studentId })
    .from(homework)
    .leftJoin(draftOrigin, eq(draftOrigin.homeworkId, homework.id))
    .where(and(eq(homework.id, id), eq(homework.teacherId, teacherId)));
  if (!row) return null;
  return {
    ...toSummary(row),
    studentId: row.studentId,
    tasks: (row.document as HomeworkDocument).tasks,
  };
}

/**
 * Replaces the tasks of a draft (#37): the editor sends the whole list after
 * every change. Returns false when there is no such draft; a published
 * homework never changes.
 */
export async function updateDraftTasks(db: Database, teacherId: string, id: string, document: HomeworkDocument): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(homework)
      .set({ document: homeworkSchema.parse(document), title: document.title })
      .where(and(eq(homework.id, id), eq(homework.teacherId, teacherId), eq(homework.status, "draft")))
      .returning({ id: homework.id });
    if (rows.length === 0) return false;
    // An assistant's draft the teacher edited is hers now: the assistant's next save makes a new one (#43).
    await tx
      .update(draftOrigin)
      .set({ teacherEditedAt: sql`now()` })
      .where(and(eq(draftOrigin.homeworkId, id), isNull(draftOrigin.teacherEditedAt)));
    return true;
  });
}

/**
 * Publishes a draft with a deadline. The student's previously published
 * homework is closed as "missed" in the same transaction (product
 * requirements 5.1.6, item 4). Returns false when there is no such draft.
 */
export async function publishHomework(
  db: Database,
  teacherId: string,
  id: string,
  dueDate: string,
): Promise<"published" | "not_found" | "past"> {
  return db.transaction(async (tx) => {
    const [draft] = await tx
      .select({ studentId: homework.studentId })
      .from(homework)
      .where(and(eq(homework.id, id), eq(homework.teacherId, teacherId), eq(homework.status, "draft")))
      .for("update");
    if (!draft) return "not_found";
    // Publishing for one student goes one at a time: two drafts published at
    // the same moment both succeed, the later one closing the earlier, instead
    // of the second meeting the one-published index (#65).
    const [owner] = await tx
      .select({ timeZone: student.timeZone })
      .from(student)
      .where(eq(student.id, draft.studentId))
      .for("update");
    // A deadline is a date in the student's time zone; one before their today is a mistake.
    if (!owner || dueDate < todayIn(owner.timeZone)) return "past";
    // A submitted homework has the status "submitted", so "published" is unsubmitted.
    await tx
      .update(homework)
      .set({ status: "missed" })
      .where(and(eq(homework.studentId, draft.studentId), eq(homework.teacherId, teacherId), eq(homework.status, "published")));
    await tx
      .update(homework)
      .set({ status: "published", dueDate, publishedAt: sql`now()` })
      .where(eq(homework.id, id));
    return "published";
  });
}

/**
 * Takes a published homework back to a draft before the student submits.
 * Returns false when there is no such published homework: a submitted one
 * has the status "submitted" and stays. The student's unsubmitted answers
 * go with it, because the draft may change before it is published again.
 */
export async function unpublishHomework(db: Database, teacherId: string, id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(homework)
      .set({ status: "draft", dueDate: null, publishedAt: null })
      .where(and(eq(homework.id, id), eq(homework.teacherId, teacherId), eq(homework.status, "published")))
      .returning({ attempt: homework.attempt });
    const [taken] = rows;
    if (!taken) return false;
    // Only the attempt in progress: earlier, submitted attempts stay in the history (#36).
    await tx
      .delete(homeworkAnswer)
      .where(and(eq(homeworkAnswer.homeworkId, id), eq(homeworkAnswer.attempt, taken.attempt)));
    return true;
  });
}

/** The score: right and wrong auto-checked tasks, and the tasks the teacher checks (#35). */
export type HomeworkResult = { correct: number; wrong: number; pending: number };

/**
 * What the student's page shows: the newest published or submitted homework,
 * with the score of the current submission once it is submitted; a reopened
 * homework is published again and shows its tasks (#36). A homework past its deadline can still
 * be done until the next one is published (product requirements 5.1.3).
 */
export async function currentHomeworkForStudent(
  db: Database,
  teacherId: string,
  studentId: string,
): Promise<{ id: string; dueDate: string; taskCount: number; result: HomeworkResult | null } | null> {
  const [row] = await db
    .select({
      id: homework.id,
      dueDate: homework.dueDate,
      document: homework.document,
      correct: homeworkSubmission.correctCount,
      wrong: homeworkSubmission.wrongCount,
    })
    .from(homework)
    .leftJoin(
      homeworkSubmission,
      and(eq(homeworkSubmission.homeworkId, homework.id), eq(homeworkSubmission.isCurrent, true)),
    )
    .where(
      and(
        eq(homework.teacherId, teacherId),
        eq(homework.studentId, studentId),
        inArray(homework.status, ["published", "submitted"]),
      ),
    )
    .orderBy(desc(homework.publishedAt))
    .limit(1);
  if (!row || !row.dueDate) return null;
  return {
    id: row.id,
    dueDate: row.dueDate,
    taskCount: taskCount(row.document),
    result: row.correct === null || row.wrong === null ? null : score(row.document, row.correct, row.wrong),
  };
}

/**
 * Every task is either checked by the platform or by the teacher, so the
 * tasks the teacher checks are the rest. Counted from the document rather
 * than the submission's pending count, which falls as the teacher marks.
 */
function score(document: unknown, correct: number, wrong: number): HomeworkResult {
  return { correct, wrong, pending: taskCount(document) - correct - wrong };
}

const ownPublished = (teacherId: string, studentId: string, id: string) =>
  and(
    eq(homework.id, id),
    eq(homework.teacherId, teacherId),
    eq(homework.studentId, studentId),
    eq(homework.status, "published"),
  );

/**
 * The seed of a task's shuffle: the same on every device, and not something
 * the student can compute from what they see (the homework id is theirs, the
 * shuffle is public code), so it is derived from a server secret. Rotating
 * LINK_KEY reshuffles the tiles, which is harmless: answers hold values.
 */
export function shuffleSeed(homeworkId: string, taskIndex: number): string {
  return createHmac("sha256", env().LINK_KEY).update(`shuffle|${homeworkId}|${taskIndex}`).digest("base64url");
}

/**
 * The tasks of a published homework as the student sees them — never a key
 * (AGENTS.md, rule 4) — and the answers saved so far, one per task or null.
 * Null when there is no such published homework of this student.
 */
export async function openHomework(
  db: Database,
  teacherId: string,
  studentId: string,
  id: string,
): Promise<{ tasks: StudentTask[]; answers: (StudentAnswer | null)[] } | null> {
  const [row] = await db
    .select({ document: homework.document, attempt: homework.attempt })
    .from(homework)
    .where(ownPublished(teacherId, studentId, id));
  if (!row) return null;
  const tasks = (row.document as HomeworkDocument).tasks;
  // The attempt in progress: a reopened homework starts blank (#36).
  const saved = await db
    .select({ taskIndex: homeworkAnswer.taskIndex, answer: homeworkAnswer.answer })
    .from(homeworkAnswer)
    .where(and(eq(homeworkAnswer.homeworkId, id), eq(homeworkAnswer.attempt, row.attempt)));
  const answers: (StudentAnswer | null)[] = tasks.map(() => null);
  for (const { taskIndex, answer } of saved) {
    const parsed = storedAnswerSchema.safeParse(answer);
    if (!parsed.success || taskIndex >= answers.length) continue;
    const stored = parsed.data;
    // A recording or a file goes out as its address, never as the stored reference.
    answers[taskIndex] =
      stored.type === "voice" || stored.type === "file"
        ? { type: stored.type, url: answerFileUrl(id, taskIndex), contentType: stored.contentType }
        : stored;
  }
  return {
    tasks: tasks.map((task, index) => ({
      ...studentView(task, shuffleSeed(id, index)),
      ...(task.image ? { image: homeworkImageUrl(id, index) } : {}),
    })),
    answers,
  };
}

/**
 * Saves the answer to one task while the homework is published. Returns
 * "not_found" for anything that is not this student's published homework,
 * and "invalid" for an answer that cannot belong to the task.
 */
export function saveAnswer(
  db: Database,
  teacherId: string,
  studentId: string,
  id: string,
  taskIndex: number,
  answer: Answer | null,
): Promise<"saved" | "not_found" | "invalid"> {
  return storeAnswer(db, teacherId, studentId, id, taskIndex, answer, null, (task) => !answer || fitsTask(task, answer));
}

/**
 * Saves a recording or a file the server has just kept in the blob store
 * (#35). Only the upload calls this: the page can never name a stored file.
 * It goes to the attempt the upload started in: if the homework was
 * submitted and reopened meanwhile, the new attempt stays blank.
 */
export function saveFileAnswer(
  db: Database,
  teacherId: string,
  studentId: string,
  id: string,
  taskIndex: number,
  attempt: number,
  answer: StoredAnswer & { type: "voice" | "file" },
): Promise<"saved" | "not_found" | "invalid"> {
  return storeAnswer(db, teacherId, studentId, id, taskIndex, answer, attempt, (task) => task.type === answer.type);
}

/** The task of this student's published homework that a file may answer, with the attempt in progress, or null. */
export async function publishedTask(
  db: Database,
  teacherId: string,
  studentId: string,
  id: string,
  taskIndex: number,
): Promise<{ task: Task; attempt: number } | null> {
  const [row] = await db
    .select({ document: homework.document, attempt: homework.attempt })
    .from(homework)
    .where(ownPublished(teacherId, studentId, id));
  const task = (row?.document as HomeworkDocument | undefined)?.tasks[taskIndex];
  return row && task ? { task, attempt: row.attempt } : null;
}

async function storeAnswer(
  db: Database,
  teacherId: string,
  studentId: string,
  id: string,
  taskIndex: number,
  answer: StoredAnswer | null,
  attempt: number | null,
  fits: (task: Task) => boolean,
): Promise<"saved" | "not_found" | "invalid"> {
  return db.transaction(async (tx) => {
    // A shared lock: a submission (FOR UPDATE) waits for the save, or the save
    // sees the homework submitted and stops.
    const [row] = await tx
      .select({ document: homework.document, attempt: homework.attempt })
      .from(homework)
      .where(ownPublished(teacherId, studentId, id))
      .for("share");
    if (!row || (attempt !== null && row.attempt !== attempt)) return "not_found";
    const task = (row.document as HomeworkDocument).tasks[taskIndex];
    if (!task || !fits(task)) return "invalid";
    await tx
      .insert(homeworkAnswer)
      .values({ homeworkId: id, attempt: row.attempt, taskIndex, answer })
      .onConflictDoUpdate({
        target: [homeworkAnswer.homeworkId, homeworkAnswer.attempt, homeworkAnswer.taskIndex],
        set: { answer, updatedAt: sql`now()` },
      });
    return "saved";
  });
}

const isAutoChecked = (task: Task) => task.type !== "written" && task.type !== "voice" && task.type !== "file";

/**
 * Submits the attempt in progress once and returns the score. Every task gets
 * a stored answer with its topic and skill: an auto-checked one with its
 * correctness (an unanswered one is wrong), one the teacher checks waits for
 * her mark (#36). A repeat with the same idempotency key returns the same
 * score; any other second submission of the attempt is "conflict". A new
 * attempt exists only after the teacher reopens the homework.
 */
export async function submitHomework(
  db: Database,
  teacherId: string,
  studentId: string,
  id: string,
  idempotencyKey: string,
): Promise<HomeworkResult | "not_found" | "conflict"> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ status: homework.status, document: homework.document, attempt: homework.attempt })
      .from(homework)
      .where(
        and(
          eq(homework.id, id),
          eq(homework.teacherId, teacherId),
          eq(homework.studentId, studentId),
          inArray(homework.status, ["published", "submitted"]),
        ),
      )
      .for("update");
    if (!row) return "not_found";

    const [earlier] = await tx
      .select({
        key: homeworkSubmission.idempotencyKey,
        correct: homeworkSubmission.correctCount,
        wrong: homeworkSubmission.wrongCount,
      })
      .from(homeworkSubmission)
      .where(and(eq(homeworkSubmission.homeworkId, id), eq(homeworkSubmission.attempt, row.attempt)));
    if (earlier) return earlier.key === idempotencyKey ? score(row.document, earlier.correct, earlier.wrong) : "conflict";
    if (row.status !== "published") return "not_found";

    const tasks = (row.document as HomeworkDocument).tasks;
    const saved = await tx
      .select({ taskIndex: homeworkAnswer.taskIndex, answer: homeworkAnswer.answer })
      .from(homeworkAnswer)
      .where(and(eq(homeworkAnswer.homeworkId, id), eq(homeworkAnswer.attempt, row.attempt)))
      .orderBy(asc(homeworkAnswer.taskIndex));
    const byIndex = new Map(saved.map((s) => [s.taskIndex, storedAnswerSchema.safeParse(s.answer)]));

    let correct = 0;
    let wrong = 0;
    let pending = 0;
    for (const [taskIndex, task] of tasks.entries()) {
      const parsed = byIndex.get(taskIndex);
      const answer = parsed?.success ? parsed.data : null;
      // Written, voice and file answers are kept as they are, for the teacher to mark (#36).
      const isCorrect = isAutoChecked(task) ? answer !== null && answer.type !== "voice" && answer.type !== "file" && checkAnswer(task, answer) : null;
      if (isCorrect === true) correct++;
      else if (isCorrect === false) wrong++;
      else pending++;
      const fields = { correct: isCorrect, topic: task.topic ?? null, skill: task.skill ?? null };
      await tx
        .insert(homeworkAnswer)
        .values({ homeworkId: id, attempt: row.attempt, taskIndex, answer, ...fields })
        .onConflictDoUpdate({
          target: [homeworkAnswer.homeworkId, homeworkAnswer.attempt, homeworkAnswer.taskIndex],
          set: { ...fields, updatedAt: sql`now()` },
        });
    }
    await tx.insert(homeworkSubmission).values({
      homeworkId: id,
      attempt: row.attempt,
      idempotencyKey,
      correctCount: correct,
      wrongCount: wrong,
      pendingCount: pending,
    });
    await tx.update(homework).set({ status: "submitted" }).where(eq(homework.id, id));
    return { correct, wrong, pending };
  });
}
