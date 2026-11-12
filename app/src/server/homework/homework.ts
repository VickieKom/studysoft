// Homework drafts and their publication (#32). The document is stored as
// imported and never changes after publishing. The teacher's preview shows it
// whole, keys included; a student only ever gets studentView() — without the
// keys (AGENTS.md, rule 4).
import { createHmac } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  type Answer,
  answerSchema,
  type HomeworkDocument,
  homeworkSchema,
  type StudentTask,
  studentView,
  type Task,
} from "../../domain/homework-format";
import type { Database } from "../db/client";
import { homework, homeworkAnswer, homeworkSubmission, student } from "../db/schema";
import { env } from "../env";
import { homeworkImageUrl, todayIn } from "../../domain/homework";
import { checkAnswer, fitsTask } from "./check";

export const HOMEWORK_STATUSES = ["draft", "published", "submitted", "missed"] as const;
export type HomeworkStatus = (typeof HOMEWORK_STATUSES)[number];

export type HomeworkSummary = {
  id: string;
  title: string;
  status: HomeworkStatus;
  dueDate: string | null;
  taskCount: number;
  createdAt: Date;
};

const summaryColumns = {
  id: homework.id,
  title: homework.title,
  status: homework.status,
  dueDate: homework.dueDate,
  document: homework.document,
  createdAt: homework.createdAt,
};

type Row = { id: string; title: string; status: string; dueDate: string | null; document: unknown; createdAt: Date };

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
  const rows = await db
    .update(homework)
    .set({ document: homeworkSchema.parse(document), title: document.title })
    .where(and(eq(homework.id, id), eq(homework.teacherId, teacherId), eq(homework.status, "draft")))
    .returning({ id: homework.id });
  return rows.length > 0;
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
      .returning({ id: homework.id });
    if (rows.length === 0) return false;
    await tx.delete(homeworkAnswer).where(eq(homeworkAnswer.homeworkId, id));
    return true;
  });
}

export type HomeworkResult = { correct: number; wrong: number };

/**
 * What the student's page shows: the newest published or submitted homework,
 * with the score once it is submitted. A homework past its deadline can still
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
    .leftJoin(homeworkSubmission, eq(homeworkSubmission.homeworkId, homework.id))
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
    result: row.correct === null || row.wrong === null ? null : { correct: row.correct, wrong: row.wrong },
  };
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
): Promise<{ tasks: StudentTask[]; answers: (Answer | null)[] } | null> {
  const [row] = await db.select({ document: homework.document }).from(homework).where(ownPublished(teacherId, studentId, id));
  if (!row) return null;
  const tasks = (row.document as HomeworkDocument).tasks;
  const saved = await db
    .select({ taskIndex: homeworkAnswer.taskIndex, answer: homeworkAnswer.answer })
    .from(homeworkAnswer)
    .where(eq(homeworkAnswer.homeworkId, id));
  const answers: (Answer | null)[] = tasks.map(() => null);
  for (const { taskIndex, answer } of saved) {
    const parsed = answerSchema.safeParse(answer);
    if (parsed.success && taskIndex < answers.length) answers[taskIndex] = parsed.data;
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
export async function saveAnswer(
  db: Database,
  teacherId: string,
  studentId: string,
  id: string,
  taskIndex: number,
  answer: Answer | null,
): Promise<"saved" | "not_found" | "invalid"> {
  return db.transaction(async (tx) => {
    // A shared lock: a submission (FOR UPDATE) waits for the save, or the save
    // sees the homework submitted and stops.
    const [row] = await tx
      .select({ document: homework.document })
      .from(homework)
      .where(ownPublished(teacherId, studentId, id))
      .for("share");
    if (!row) return "not_found";
    const task = (row.document as HomeworkDocument).tasks[taskIndex];
    if (!task) return "invalid";
    if (answer && !fitsTask(task, answer)) return "invalid";
    await tx
      .insert(homeworkAnswer)
      .values({ homeworkId: id, taskIndex, answer })
      .onConflictDoUpdate({
        target: [homeworkAnswer.homeworkId, homeworkAnswer.taskIndex],
        set: { answer, updatedAt: sql`now()` },
      });
    return "saved";
  });
}

const isAutoChecked = (task: Task) => task.type !== "written" && task.type !== "voice" && task.type !== "file";

/**
 * Submits a published homework once and returns the score. Every task gets a
 * stored answer with its correctness, topic and skill; an unanswered task is
 * wrong. A repeat with the same idempotency key returns the same score; any
 * other second submission is "conflict".
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
      .select({ status: homework.status, document: homework.document })
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
      .where(eq(homeworkSubmission.homeworkId, id));
    if (earlier) return earlier.key === idempotencyKey ? { correct: earlier.correct, wrong: earlier.wrong } : "conflict";
    if (row.status !== "published") return "not_found";

    const tasks = (row.document as HomeworkDocument).tasks;
    const saved = await tx
      .select({ taskIndex: homeworkAnswer.taskIndex, answer: homeworkAnswer.answer })
      .from(homeworkAnswer)
      .where(eq(homeworkAnswer.homeworkId, id))
      .orderBy(asc(homeworkAnswer.taskIndex));
    const byIndex = new Map(saved.map((s) => [s.taskIndex, answerSchema.safeParse(s.answer)]));

    let correct = 0;
    let wrong = 0;
    for (const [taskIndex, task] of tasks.entries()) {
      // shortcut: written, voice and file tasks are not answered or counted yet (#35)
      if (!isAutoChecked(task)) continue;
      const parsed = byIndex.get(taskIndex);
      const answer = parsed?.success ? parsed.data : null;
      const isCorrect = answer !== null && checkAnswer(task, answer);
      if (isCorrect) correct++;
      else wrong++;
      const fields = { correct: isCorrect, topic: task.topic ?? null, skill: task.skill ?? null };
      await tx
        .insert(homeworkAnswer)
        .values({ homeworkId: id, taskIndex, answer, ...fields })
        .onConflictDoUpdate({
          target: [homeworkAnswer.homeworkId, homeworkAnswer.taskIndex],
          set: { ...fields, updatedAt: sql`now()` },
        });
    }
    await tx.insert(homeworkSubmission).values({ homeworkId: id, idempotencyKey, correctCount: correct, wrongCount: wrong });
    await tx.update(homework).set({ status: "submitted" }).where(eq(homework.id, id));
    return { correct, wrong };
  });
}
