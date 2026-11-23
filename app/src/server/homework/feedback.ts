// «Мини-вопрос после домашки» (#331): after a homework's first «Сдать», when
// the teacher ticked the box in its draft, the child picks the most
// interesting kind of the homework's tasks, «Все классные», or skips. A
// homework of one kind of task asks nothing (product owner, 2026-11-23). The
// answer counts for nothing: not the score, not the homework's statistics.
// The answers reach the teacher only, in «Фидбэк» on the card; no student or
// parent procedure returns them (AGENTS.md, rule 4).
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { ALL_KINDS_ANSWER } from "../../domain/homework";
import type { HomeworkDocument, TaskType } from "../../domain/homework-format";
import type { Database } from "../db/client";
import { homework, homeworkFeedback } from "../db/schema";

/** The kinds of a homework's tasks, each once, in the order they first come. */
export function taskKinds(document: HomeworkDocument): TaskType[] {
  return [...new Set(document.tasks.map((task) => task.type))];
}

/** Whether a draft's question would be asked: a homework of one kind of task asks nothing. */
export const asksSomething = (document: HomeworkDocument) => taskKinds(document).length > 1;

/**
 * The question for this student's submitted homework, or null: not ticked,
 * reopened since its first «Сдать» (#36), of one kind of task, or answered or
 * skipped already.
 */
export async function miniQuestion(database: Database, teacherId: string, studentId: string, homeworkId: string): Promise<{ kinds: TaskType[] } | null> {
  const [row] = await database
    .select({ document: homework.document, answered: homeworkFeedback.id })
    .from(homework)
    .leftJoin(homeworkFeedback, eq(homeworkFeedback.homeworkId, homework.id))
    .where(
      and(
        eq(homework.id, homeworkId),
        eq(homework.teacherId, teacherId),
        eq(homework.studentId, studentId),
        eq(homework.status, "submitted"),
        eq(homework.askFeedback, true),
        eq(homework.attempt, 1),
      ),
    );
  if (!row || row.answered) return null;
  const kinds = taskKinds(row.document as HomeworkDocument);
  return kinds.length > 1 ? { kinds } : null;
}

/**
 * The child's answer: a kind the question offered, «Все классные», or null
 * for «Пропустить». Kept once; false when there is no question to answer.
 * The unique index on the homework keeps a second answer out.
 */
export async function answerMiniQuestion(
  database: Database,
  teacherId: string,
  studentId: string,
  homeworkId: string,
  answer: TaskType | typeof ALL_KINDS_ANSWER | null,
): Promise<boolean> {
  const question = await miniQuestion(database, teacherId, studentId, homeworkId);
  return question ? answerFrom(database, teacherId, studentId, homeworkId, question, answer) : false;
}

/**
 * The answer against the question as it was read. The write is one
 * statement conditional on the homework still being asked: reopened or taken
 * back in between, it gets no answer.
 */
export async function answerFrom(
  database: Database,
  teacherId: string,
  studentId: string,
  homeworkId: string,
  question: { kinds: TaskType[] },
  answer: TaskType | typeof ALL_KINDS_ANSWER | null,
): Promise<boolean> {
  if (answer !== null && answer !== ALL_KINDS_ANSWER && !question.kinds.includes(answer)) return false;
  const rows = await database.execute(sql`
    insert into ${homeworkFeedback} (teacher_id, student_id, homework_id, answer)
    select ${homework.teacherId}, ${homework.studentId}, ${homework.id}, ${answer}::text
    from ${homework}
    where ${homework.id} = ${homeworkId} and ${homework.teacherId} = ${teacherId} and ${homework.studentId} = ${studentId}
      and ${homework.status} = 'submitted' and ${homework.askFeedback} and ${homework.attempt} = 1
    on conflict (homework_id) do nothing
    returning id`);
  return rows.length > 0;
}

export type FeedbackEntry = { homeworkTitle: string; answer: TaskType | typeof ALL_KINDS_ANSWER; answeredAt: Date };

/** «Фидбэк» on the card: the child's answers, the newest first; a skipped question leaves none. */
export async function studentFeedback(database: Database, teacherId: string, studentId: string): Promise<FeedbackEntry[]> {
  const rows = await database
    .select({ homeworkTitle: homework.title, answer: homeworkFeedback.answer, answeredAt: homeworkFeedback.createdAt })
    .from(homeworkFeedback)
    .innerJoin(homework, eq(homework.id, homeworkFeedback.homeworkId))
    .where(and(eq(homeworkFeedback.teacherId, teacherId), eq(homeworkFeedback.studentId, studentId), isNotNull(homeworkFeedback.answer)))
    .orderBy(desc(homeworkFeedback.createdAt));
  return rows.map((r) => ({ ...r, answer: r.answer as FeedbackEntry["answer"] }));
}
