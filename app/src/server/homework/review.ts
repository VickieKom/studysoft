// «Проверка домашек» (#36): the teacher's view of submissions. Only the
// current submission of a homework is reviewed; earlier attempts stay as they
// were. A submission waits for review until the teacher has opened it and
// marked every task the platform does not check (product owner, 2026-11-12).
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { answerKey, answerText, attemptAnswerFileUrl, homeworkAudioUrl, homeworkPictureUrl, sentenceKey } from "../../domain/homework";
import {
  type HomeworkDocument,
  orderSentences,
  type StoredAnswer,
  storedAnswerSchema,
  type Task,
  type TaskExample,
  withPartPictures,
} from "../../domain/homework-format";
import type { Database } from "../db/client";
import { homework, homeworkAnswer, homeworkSubmission, student } from "../db/schema";
import { countPoints, pointVerdicts, sentenceVerdicts, taskVerdict } from "./points";

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
  /** Where the task's recording to listen to plays (#127); null without one. */
  audioUrl: string | null;
  topic: string | null;
  answer: string | null;
  autoChecked: boolean;
  /** The teacher's mark if any, else the platform's result; null while it waits for her. */
  verdict: boolean | null;
  marked: boolean | null;
  key: string | null;
  /** Each sentence of an order task of several (#161), its own point; null for any other task. */
  sentences: ReviewSentence[] | null;
  /** Options with pictures (#129), as the student saw them; null when every option is text. */
  pictureOptions: { images: string[]; text: string | null; chosen: boolean; right: boolean }[] | null;
  /** The picture by each gap (#181), by its address; null when the task has none. */
  gapImages: (string | null)[] | null;
  /** A recording or file to play or show, from this submission's own attempt (#93). */
  file: { kind: "audio" | "image"; url: string } | null;
};

export type ReviewSentence = {
  answer: string | null;
  key: string;
  /** The teacher's mark if any, else the platform's result. */
  verdict: boolean;
  marked: boolean | null;
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

/** Where a mistake without a topic goes in a list by topic. */
export const NO_TOPIC = "Без темы";

type StoredRow = { taskIndex: number; answer: unknown; correct: boolean | null; mark: boolean | null; sentences: unknown };

const storedRow = {
  taskIndex: homeworkAnswer.taskIndex,
  answer: homeworkAnswer.answer,
  correct: homeworkAnswer.correct,
  mark: homeworkAnswer.teacherMark,
  sentences: homeworkAnswer.sentenceVerdicts,
};

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
    const answer = parsed.success ? parsed.data : null;
    const verdicts = stored ? sentenceVerdicts(stored.sentences) : null;
    const sentences =
      task.type === "order" && task.sentences && verdicts
        ? orderSentences(task).map((sentence, i) => {
            const words = answer?.type === "order" ? answer.sentences?.[i] : undefined;
            return {
              answer: words && words.length > 0 ? words.join(" ") : null,
              key: sentenceKey(sentence),
              verdict: verdicts[i]?.mark ?? verdicts[i]?.correct ?? false,
              marked: verdicts[i]?.mark ?? null,
            };
          })
        : null;
    return {
      index,
      type: task.type,
      prompt: task.prompt,
      choices: task.type === "gap" ? (task.choices ?? null) : null,
      passage: task.passage ?? null,
      example: task.example ?? null,
      audioUrl: task.audio ? homeworkAudioUrl(submission.homeworkId, index) : null,
      topic: task.topic ?? null,
      answer: parsed.success ? answerText(task, parsed.data) : null,
      autoChecked,
      verdict: stored ? taskVerdict(pointVerdicts(stored)) : null,
      marked: stored?.mark ?? null,
      key: answerKey(task),
      sentences,
      pictureOptions: pictureOptions(submission.homeworkId, index, task, parsed.success ? parsed.data : null),
      gapImages:
        task.type === "gap" && task.gapImages
          ? withPartPictures(task, (_, n) => homeworkPictureUrl(submission.homeworkId, index, n)).gapImages!
          : null,
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

/** A choice task's options with their pictures' addresses, which the student chose and which are right (#129). */
function pictureOptions(homeworkId: string, index: number, task: Task, answer: StoredAnswer | null): ReviewTask["pictureOptions"] {
  if (task.type !== "single_choice" && task.type !== "multiple_choice") return null;
  if (task.options.every((option) => typeof option === "string")) return null;
  const chosen = answer?.type === "single_choice" ? [answer.choice] : answer?.type === "multiple_choice" ? answer.choices : [];
  const right = task.type === "single_choice" ? [task.answer] : task.answers;
  const options = withPartPictures(task, (_, n) => homeworkPictureUrl(homeworkId, index, n)).options;
  return options.map((option, i) => ({
    images: typeof option === "string" ? [] : option.images,
    text: typeof option === "string" ? option : (option.text ?? null),
    chosen: chosen.includes(i),
    right: right.includes(i),
  }));
}

/** Wrong answers by topic, the most frequent first; each wrong sentence of an order task counts (#161). */
function mistakesByTopic(tasks: ReviewTask[]): { topic: string; count: number }[] {
  const mistakes = new Map<string, number>();
  for (const task of tasks) {
    const wrong = task.sentences ? task.sentences.filter((s) => !s.verdict).length : task.verdict === false ? 1 : 0;
    if (wrong > 0) mistakes.set(task.topic ?? NO_TOPIC, (mistakes.get(task.topic ?? NO_TOPIC) ?? 0) + wrong);
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
    /** Each sentence of an order task of several (#161), its own point. */
    sentences?: { answer: string | null; correct: boolean; markedByTeacher: boolean }[];
  }[];
};

/** Each submitted homework of the student with its latest attempt, newest first; only those submitted since `since` when given. */
async function latestAttempts(db: Database, teacherId: string, studentId: string, since?: Date) {
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
  return latest
    .filter((row) => !since || row.submittedAt >= since)
    .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());
}

/** The tasks of each attempt with the student's answers and the verdicts, read in one query. */
async function attemptsTasks<Row extends { homeworkId: string; attempt: number; document: unknown }>(db: Database, rows: Row[]) {
  if (rows.length === 0) return [];
  const answers = await db
    .select({ homeworkId: homeworkAnswer.homeworkId, attempt: homeworkAnswer.attempt, ...storedRow })
    .from(homeworkAnswer)
    .where(inArray(homeworkAnswer.homeworkId, rows.map((row) => row.homeworkId)));
  return rows.map((row) => {
    const document = (row.document as HomeworkDocument).tasks;
    const own = answers.filter((a) => a.homeworkId === row.homeworkId && a.attempt === row.attempt);
    return { row, document, tasks: reviewTasks(row, document, own) };
  });
}

/**
 * The student's latest submitted homework for the assistant (#44), newest
 * first: each with its latest attempt, the answers as text and right or
 * wrong. No keys: the assistant gets what the student answered, not the
 * expected answers. A homework published but not submitted is not here; a
 * reopened one shows the attempt it was submitted with. The mistakes by topic
 * come from the student's one list of mistakes (#119).
 */
export async function recentResults(db: Database, teacherId: string, studentId: string): Promise<RecentHomework[]> {
  const chosen = (await latestAttempts(db, teacherId, studentId)).slice(0, CONTEXT_HOMEWORK);
  const recentHomework: RecentHomework[] = [];
  for (const { row, document, tasks } of await attemptsTasks(db, chosen)) {
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
        markedByTeacher: task.marked !== null || (task.sentences ?? []).some((s) => s.marked !== null),
        ...(task.sentences
          ? { sentences: task.sentences.map((s) => ({ answer: s.answer, correct: s.verdict, markedByTeacher: s.marked !== null })) }
          : {}),
      })),
    });
  }
  return recentHomework;
}

export type HomeworkMistake = { topic: string | null; task: string; answer: string | null; title: string; at: Date };

/**
 * The wrong answers of the student's homework submitted since `since` (#119),
 * newest first: the latest attempt of each, with the teacher's mark winning
 * over the platform's result. A task waiting for her is not a mistake yet.
 */
export async function homeworkMistakes(
  db: Database,
  teacherId: string,
  studentId: string,
  since: Date,
): Promise<HomeworkMistake[]> {
  const mistakes: HomeworkMistake[] = [];
  for (const { row, tasks } of await attemptsTasks(db, await latestAttempts(db, teacherId, studentId, since))) {
    for (const task of tasks) {
      if (task.verdict === false) {
        mistakes.push({ topic: task.topic, task: task.prompt, answer: task.answer, title: row.title, at: row.submittedAt });
      }
    }
  }
  return mistakes;
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
    .select(storedRow)
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
 * auto-checked task this overrides the platform. An order task of several
 * sentences is marked a sentence at a time (product owner, 2026-11-18), so
 * `sentence` names one for it and is left out for any other task. The score
 * is counted again from the stored answers. Returns false when there is no
 * such current submission, task or sentence.
 */
export async function markTask(
  db: Database,
  teacherId: string,
  id: string,
  taskIndex: number,
  mark: boolean,
  sentence?: number,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ homeworkId: homeworkSubmission.homeworkId, attempt: homeworkSubmission.attempt })
      .from(homeworkSubmission)
      .innerJoin(homework, eq(homework.id, homeworkSubmission.homeworkId))
      .where(and(eq(homeworkSubmission.id, id), eq(homework.teacherId, teacherId), eq(homeworkSubmission.isCurrent, true)))
      .for("update", { of: homeworkSubmission });
    if (!row) return false;
    // Every mark of this submission holds its row first, so the sentences read
    // here cannot change before the write below.
    const attempt = and(eq(homeworkAnswer.homeworkId, row.homeworkId), eq(homeworkAnswer.attempt, row.attempt));
    const [answer] = await tx
      .select({ id: homeworkAnswer.id, sentences: homeworkAnswer.sentenceVerdicts })
      .from(homeworkAnswer)
      .where(and(attempt, eq(homeworkAnswer.taskIndex, taskIndex)));
    if (!answer) return false;
    const sentences = sentenceVerdicts(answer.sentences);
    if ((sentences === null) !== (sentence === undefined)) return false;
    if (sentences && sentence !== undefined) {
      if (sentence >= sentences.length) return false;
      const marked = sentences.map((s, i) => (i === sentence ? { ...s, mark } : s));
      await tx.update(homeworkAnswer).set({ sentenceVerdicts: marked, updatedAt: sql`now()` }).where(eq(homeworkAnswer.id, answer.id));
    } else {
      await tx.update(homeworkAnswer).set({ teacherMark: mark, updatedAt: sql`now()` }).where(eq(homeworkAnswer.id, answer.id));
    }

    const counts = countPoints(await tx.select(storedRow).from(homeworkAnswer).where(attempt));
    await tx
      .update(homeworkSubmission)
      .set({ correctCount: counts.correct, wrongCount: counts.wrong, pendingCount: counts.pending })
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

