// «Проверка домашек» (#36): the teacher's view of submissions. Only the
// current submission of a homework is reviewed; earlier attempts stay as they
// were. A submission waits for review until the teacher has opened it and
// marked every task the platform does not check (product owner, 2026-11-12).
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { answerKey, answerText, attemptAnswerFileUrl } from "../../domain/homework";
import { type HomeworkDocument, storedAnswerSchema, type Task, type TaskExample } from "../../domain/homework-format";
import type { Database } from "../db/client";
import { homework, homeworkAnswer, homeworkSubmission, student } from "../db/schema";

const waitingCondition = or(isNull(homeworkSubmission.openedAt), sql`${homeworkSubmission.pendingCount} > 0`);

/** How many current submissions of this teacher wait for review: the number in the menu. */
export async function waitingCount(db: Database, teacherId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(homeworkSubmission)
    .innerJoin(homework, eq(homework.id, homeworkSubmission.homeworkId))
    // The same students the list shows: a deleted student's submission is not counted.
    .innerJoin(student, and(eq(student.id, homework.studentId), isNull(student.deletedAt)))
    .where(and(eq(homework.teacherId, teacherId), eq(homeworkSubmission.isCurrent, true), waitingCondition));
  return row?.count ?? 0;
}

export type ReviewRow = {
  homeworkId: string;
  submissionId: string | null;
  title: string;
  studentName: string;
  date: Date | null;
  correct: number | null;
  wrong: number | null;
  pending: number | null;
  waiting: boolean;
  missed: boolean;
};

/** Current submissions and homework the student did not submit, newest first; optionally one student's. */
export async function listReview(db: Database, teacherId: string, studentId: string | null): Promise<ReviewRow[]> {
  const rows = await db
    .select({
      homeworkId: homework.id,
      title: homework.title,
      status: homework.status,
      publishedAt: homework.publishedAt,
      firstName: student.firstName,
      submissionId: homeworkSubmission.id,
      submittedAt: homeworkSubmission.submittedAt,
      correct: homeworkSubmission.correctCount,
      wrong: homeworkSubmission.wrongCount,
      pending: homeworkSubmission.pendingCount,
      openedAt: homeworkSubmission.openedAt,
    })
    .from(homework)
    .innerJoin(student, and(eq(student.id, homework.studentId), isNull(student.deletedAt)))
    .leftJoin(
      homeworkSubmission,
      and(eq(homeworkSubmission.homeworkId, homework.id), eq(homeworkSubmission.isCurrent, true)),
    )
    .where(
      and(
        eq(homework.teacherId, teacherId),
        studentId ? eq(homework.studentId, studentId) : undefined,
        or(eq(homework.status, "missed"), isNotNull(homeworkSubmission.id)),
      ),
    )
    .orderBy(desc(sql`coalesce(${homeworkSubmission.submittedAt}, ${homework.publishedAt})`));
  return rows.map((row) => ({
    homeworkId: row.homeworkId,
    submissionId: row.submissionId,
    title: row.title,
    studentName: row.firstName,
    date: row.submittedAt ?? row.publishedAt,
    correct: row.correct,
    wrong: row.wrong,
    pending: row.pending,
    waiting: row.submissionId !== null && (row.openedAt === null || (row.pending ?? 0) > 0),
    missed: row.submissionId === null,
  }));
}

export type ReviewTask = {
  index: number;
  type: string;
  prompt: string;
  /** A gap task's own options per gap (#128); null for any other task. */
  choices: (string[] | null)[] | null;
  /** The reading text and the example of a workbook exercise (#131). */
  passage: string | null;
  example: TaskExample | null;
  topic: string | null;
  answer: string | null;
  autoChecked: boolean;
  /** The teacher's mark if any, else the platform's result; null while it waits for her. */
  verdict: boolean | null;
  marked: boolean | null;
  key: string | null;
  /** A recording or file to play or show, from this submission's own attempt (#93). */
  file: { kind: "audio" | "image"; url: string } | null;
};

export type ReviewSubmission = {
  id: string;
  homeworkId: string;
  title: string;
  studentName: string;
  attempt: number;
  isCurrent: boolean;
  canReopen: boolean;
  submittedAt: Date;
  correct: number;
  wrong: number;
  pending: number;
  comment: string;
  tasks: ReviewTask[];
  mistakesByTopic: { topic: string; count: number }[];
  attempts: { id: string; attempt: number; submittedAt: Date; correct: number; wrong: number; isCurrent: boolean }[];
};

const NO_TOPIC = "Без темы";

type StoredRow = { taskIndex: number; answer: unknown; correct: boolean | null; mark: boolean | null };

/**
 * The tasks of one submission with the student's answers and the verdicts; a
 * recording or file points at that submission's own attempt (#93).
 */
function reviewTasks(
  submission: { homeworkId: string; attempt: number },
  tasks: Task[],
  answers: StoredRow[],
): ReviewTask[] {
  const byIndex = new Map(answers.map((a) => [a.taskIndex, a]));
  return tasks.map((task, index) => {
    const stored = byIndex.get(index);
    const parsed = storedAnswerSchema.safeParse(stored?.answer);
    const autoChecked = task.type !== "written" && task.type !== "voice" && task.type !== "file";
    return {
      index,
      type: task.type,
      prompt: task.prompt,
      choices: task.type === "gap" ? (task.choices ?? null) : null,
      passage: task.passage ?? null,
      example: task.example ?? null,
      topic: task.topic ?? null,
      answer: parsed.success ? answerText(task, parsed.data) : null,
      autoChecked,
      verdict: stored?.mark ?? stored?.correct ?? null,
      marked: stored?.mark ?? null,
      key: answerKey(task),
      file:
        parsed.success && (parsed.data.type === "voice" || parsed.data.type === "file") && parsed.data.type === task.type
          ? {
              kind: parsed.data.contentType.startsWith("image/") ? "image" : "audio",
              url: attemptAnswerFileUrl(submission.homeworkId, submission.attempt, index),
            }
          : null,
    };
  });
}

/** Wrong answers by topic, the most frequent first. */
function mistakesByTopic(tasks: ReviewTask[]): { topic: string; count: number }[] {
  const mistakes = new Map<string, number>();
  for (const task of tasks) {
    if (task.verdict === false) mistakes.set(task.topic ?? NO_TOPIC, (mistakes.get(task.topic ?? NO_TOPIC) ?? 0) + 1);
  }
  return [...mistakes].map(([topic, count]) => ({ topic, count })).sort((a, b) => b.count - a.count);
}

/** How many of the latest submitted homework the student context carries (#44). */
export const CONTEXT_HOMEWORK = 3;

export type RecentHomework = {
  title: string;
  submittedAt: Date;
  /** The teacher's comment, null when she has written none. */
  comment: string | null;
  tasks: {
    prompt: string;
    type: Task["type"];
    topic: string | null;
    source: NonNullable<Task["source"]> | null;
    answer: string | null;
    /** The teacher's mark if any, else the platform's result; null while it waits for her. */
    correct: boolean | null;
    markedByTeacher: boolean;
  }[];
};

/**
 * The student's latest submitted homework for the assistant (#44), newest
 * first: each with its latest attempt, the answers as text and right or wrong,
 * and the wrong answers by topic across them. No keys: the assistant gets what
 * the student answered, not the expected answers. A homework published but
 * not submitted is not here; a reopened one shows the attempt it was
 * submitted with.
 */
export async function recentResults(
  db: Database,
  teacherId: string,
  studentId: string,
): Promise<{ recentHomework: RecentHomework[]; mistakesByTopic: { topic: string; count: number }[] }> {
  const latest = await db
    .selectDistinctOn([homeworkSubmission.homeworkId], {
      homeworkId: homework.id,
      title: homework.title,
      document: homework.document,
      comment: homework.reviewComment,
      attempt: homeworkSubmission.attempt,
      submittedAt: homeworkSubmission.submittedAt,
    })
    .from(homeworkSubmission)
    .innerJoin(homework, eq(homework.id, homeworkSubmission.homeworkId))
    .where(and(eq(homework.teacherId, teacherId), eq(homework.studentId, studentId)))
    .orderBy(homeworkSubmission.homeworkId, desc(homeworkSubmission.attempt));
  const chosen = latest.sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime()).slice(0, CONTEXT_HOMEWORK);

  const all: ReviewTask[] = [];
  const recentHomework: RecentHomework[] = [];
  for (const row of chosen) {
    const answers = await db
      .select({
        taskIndex: homeworkAnswer.taskIndex,
        answer: homeworkAnswer.answer,
        correct: homeworkAnswer.correct,
        mark: homeworkAnswer.teacherMark,
      })
      .from(homeworkAnswer)
      .where(and(eq(homeworkAnswer.homeworkId, row.homeworkId), eq(homeworkAnswer.attempt, row.attempt)));
    const document = (row.document as HomeworkDocument).tasks;
    const tasks = reviewTasks(row, document, answers);
    all.push(...tasks);
    recentHomework.push({
      title: row.title,
      submittedAt: row.submittedAt,
      comment: row.comment?.trim() ? row.comment : null,
      tasks: tasks.map((task, index) => ({
        prompt: task.prompt,
        type: document[index]!.type,
        topic: task.topic,
        source: document[index]!.source ?? null,
        answer: task.answer,
        correct: task.verdict,
        markedByTeacher: task.marked !== null,
      })),
    });
  }
  return { recentHomework, mistakesByTopic: mistakesByTopic(all) };
}

/** One submission of this teacher with every answer, or null. */
export async function findSubmission(db: Database, teacherId: string, id: string): Promise<ReviewSubmission | null> {
  const [row] = await db
    .select({
      id: homeworkSubmission.id,
      homeworkId: homework.id,
      title: homework.title,
      status: homework.status,
      currentAttempt: homework.attempt,
      document: homework.document,
      comment: homework.reviewComment,
      firstName: student.firstName,
      attempt: homeworkSubmission.attempt,
      isCurrent: homeworkSubmission.isCurrent,
      submittedAt: homeworkSubmission.submittedAt,
      correct: homeworkSubmission.correctCount,
      wrong: homeworkSubmission.wrongCount,
      pending: homeworkSubmission.pendingCount,
    })
    .from(homeworkSubmission)
    .innerJoin(homework, eq(homework.id, homeworkSubmission.homeworkId))
    .innerJoin(student, eq(student.id, homework.studentId))
    .where(and(eq(homeworkSubmission.id, id), eq(homework.teacherId, teacherId)));
  if (!row) return null;

  const answers = await db
    .select({
      taskIndex: homeworkAnswer.taskIndex,
      answer: homeworkAnswer.answer,
      correct: homeworkAnswer.correct,
      mark: homeworkAnswer.teacherMark,
    })
    .from(homeworkAnswer)
    .where(and(eq(homeworkAnswer.homeworkId, row.homeworkId), eq(homeworkAnswer.attempt, row.attempt)));
  const tasks = reviewTasks(row, (row.document as HomeworkDocument).tasks, answers);

  const attempts = await db
    .select({
      id: homeworkSubmission.id,
      attempt: homeworkSubmission.attempt,
      submittedAt: homeworkSubmission.submittedAt,
      correct: homeworkSubmission.correctCount,
      wrong: homeworkSubmission.wrongCount,
      isCurrent: homeworkSubmission.isCurrent,
    })
    .from(homeworkSubmission)
    .where(eq(homeworkSubmission.homeworkId, row.homeworkId))
    .orderBy(desc(homeworkSubmission.attempt));

  return {
    id: row.id,
    homeworkId: row.homeworkId,
    title: row.title,
    studentName: row.firstName,
    attempt: row.attempt,
    isCurrent: row.isCurrent,
    canReopen: row.isCurrent && row.status === "submitted" && row.attempt === row.currentAttempt,
    submittedAt: row.submittedAt,
    correct: row.correct,
    wrong: row.wrong,
    pending: row.pending,
    comment: row.comment ?? "",
    tasks,
    mistakesByTopic: mistakesByTopic(tasks),
    attempts,
  };
}

/** The teacher has opened the submission: without tasks to mark, it stops waiting. */
export async function markOpened(db: Database, teacherId: string, id: string): Promise<void> {
  await db
    .update(homeworkSubmission)
    .set({ openedAt: sql`now()` })
    .where(
      and(
        eq(homeworkSubmission.id, id),
        isNull(homeworkSubmission.openedAt),
        inArray(
          homeworkSubmission.homeworkId,
          db.select({ id: homework.id }).from(homework).where(eq(homework.teacherId, teacherId)),
        ),
      ),
    );
}

/**
 * The teacher marks a task of the current submission right or wrong; for an
 * auto-checked task this overrides the platform. The score is counted again
 * from the stored answers. Returns false when there is no such current
 * submission or task.
 */
export async function markTask(
  db: Database,
  teacherId: string,
  id: string,
  taskIndex: number,
  mark: boolean,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ homeworkId: homeworkSubmission.homeworkId, attempt: homeworkSubmission.attempt })
      .from(homeworkSubmission)
      .innerJoin(homework, eq(homework.id, homeworkSubmission.homeworkId))
      .where(and(eq(homeworkSubmission.id, id), eq(homework.teacherId, teacherId), eq(homeworkSubmission.isCurrent, true)))
      .for("update", { of: homeworkSubmission });
    if (!row) return false;
    const updated = await tx
      .update(homeworkAnswer)
      .set({ teacherMark: mark, updatedAt: sql`now()` })
      .where(
        and(
          eq(homeworkAnswer.homeworkId, row.homeworkId),
          eq(homeworkAnswer.attempt, row.attempt),
          eq(homeworkAnswer.taskIndex, taskIndex),
        ),
      )
      .returning({ id: homeworkAnswer.id });
    if (updated.length === 0) return false;

    const verdict = sql`coalesce(${homeworkAnswer.teacherMark}, ${homeworkAnswer.correct})`;
    const [counts] = await tx
      .select({
        correct: sql<number>`count(*) filter (where ${verdict} = true)::int`,
        wrong: sql<number>`count(*) filter (where ${verdict} = false)::int`,
        pending: sql<number>`count(*) filter (where ${verdict} is null)::int`,
      })
      .from(homeworkAnswer)
      .where(and(eq(homeworkAnswer.homeworkId, row.homeworkId), eq(homeworkAnswer.attempt, row.attempt)));
    await tx
      .update(homeworkSubmission)
      .set({ correctCount: counts!.correct, wrongCount: counts!.wrong, pendingCount: counts!.pending })
      .where(eq(homeworkSubmission.id, id));
    return true;
  });
}

/** The teacher's one comment on the homework of this submission. */
export async function saveComment(db: Database, teacherId: string, id: string, comment: string): Promise<boolean> {
  const rows = await db
    .update(homework)
    .set({ reviewComment: comment.trim() || null })
    .where(
      and(
        eq(homework.teacherId, teacherId),
        inArray(
          homework.id,
          db.select({ id: homeworkSubmission.homeworkId }).from(homeworkSubmission).where(eq(homeworkSubmission.id, id)),
        ),
      ),
    )
    .returning({ id: homework.id });
  return rows.length > 0;
}

/**
 * «Открыть заново для ученика»: the current submission stays in the history
 * as it was, and the homework is published again for a new, blank attempt.
 * "busy" when the student already has another published homework: one
 * published homework per student.
 */
export async function reopenHomework(
  db: Database,
  teacherId: string,
  id: string,
): Promise<"reopened" | "not_found" | "busy"> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ homeworkId: homework.id, studentId: homework.studentId, attempt: homework.attempt })
      .from(homeworkSubmission)
      .innerJoin(homework, eq(homework.id, homeworkSubmission.homeworkId))
      .where(
        and(
          eq(homeworkSubmission.id, id),
          eq(homework.teacherId, teacherId),
          eq(homeworkSubmission.isCurrent, true),
          eq(homework.status, "submitted"),
          eq(homeworkSubmission.attempt, homework.attempt),
        ),
      )
      .for("update", { of: homework });
    if (!row) return "not_found";
    // Publishing for one student goes one at a time (#65): holding the student
    // row, the check below and the publish after it cannot race a publish of
    // another draft.
    await tx.select({ id: student.id }).from(student).where(eq(student.id, row.studentId)).for("update");
    const [other] = await tx
      .select({ id: homework.id })
      .from(homework)
      .where(and(eq(homework.studentId, row.studentId), eq(homework.status, "published")));
    if (other) return "busy";
    await tx.update(homeworkSubmission).set({ isCurrent: false }).where(eq(homeworkSubmission.id, id));
    // Published anew, so it is the student's newest homework again.
    await tx
      .update(homework)
      .set({ status: "published", attempt: row.attempt + 1, publishedAt: sql`now()` })
      .where(eq(homework.id, row.homeworkId));
    return "reopened";
  });
}

