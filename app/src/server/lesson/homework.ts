// The homework under review in the lesson mode (#153). A homework waits for
// review when it is the student's latest submitted one and was submitted after
// their previous held lesson ended: one submitted earlier was reviewed then
// (product owner, 2026-11-19). The stage shows the current submission of a
// homework as «Проверка домашек» has it, the teacher's marks included.
import { and, desc, eq, inArray } from "drizzle-orm";
import type { WaitingHomework } from "../../domain/lesson-plan";
import type { StageHomework } from "../../domain/lesson-state";
import type { Database } from "../db/client";
import { homework, homeworkSubmission, lesson } from "../db/schema";
import { findSubmission } from "../homework/review";

/** The end of the student's latest held lesson, or null when none is held. */
async function lastHeldLessonEnd(db: Database, teacherId: string, studentId: string): Promise<Date | null> {
  const [held] = await db
    .select({ startsAt: lesson.startsAt, durationMinutes: lesson.durationMinutes })
    .from(lesson)
    .where(and(eq(lesson.teacherId, teacherId), eq(lesson.studentId, studentId), eq(lesson.status, "held")))
    .orderBy(desc(lesson.startsAt))
    .limit(1);
  return held ? new Date(held.startsAt.getTime() + held.durationMinutes * 60_000) : null;
}

/** The student's homework waiting for review, or null. */
export async function waitingHomework(db: Database, teacherId: string, studentId: string): Promise<WaitingHomework | null> {
  const [latest] = await db
    .select({ id: homework.id, title: homework.title, submittedAt: homeworkSubmission.submittedAt })
    .from(homeworkSubmission)
    .innerJoin(homework, eq(homework.id, homeworkSubmission.homeworkId))
    .where(
      and(
        eq(homework.teacherId, teacherId),
        eq(homework.studentId, studentId),
        eq(homework.status, "submitted"),
        eq(homeworkSubmission.isCurrent, true),
      ),
    )
    .orderBy(desc(homeworkSubmission.submittedAt))
    .limit(1);
  if (!latest) return null;
  const heldEnd = await lastHeldLessonEnd(db, teacherId, studentId);
  return heldEnd && latest.submittedAt <= heldEnd ? null : latest;
}

/** Which of these homework ids are the student's own: a homework stage may name only those. */
export async function studentHomeworkIds(db: Database, teacherId: string, studentId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: homework.id })
    .from(homework)
    .where(and(eq(homework.teacherId, teacherId), eq(homework.studentId, studentId), inArray(homework.id, ids)));
  return new Set(rows.map((r) => r.id));
}

/**
 * The current submissions of the student's homework with these ids, as the
 * stage shows them; a homework with no current submission (reopened, or
 * another student's) is left out.
 */
export async function stageHomework(db: Database, teacherId: string, studentId: string, ids: string[]): Promise<StageHomework[]> {
  if (ids.length === 0) return [];
  const current = await db
    .select({ submissionId: homeworkSubmission.id })
    .from(homeworkSubmission)
    .innerJoin(homework, eq(homework.id, homeworkSubmission.homeworkId))
    .where(
      and(
        eq(homework.teacherId, teacherId),
        eq(homework.studentId, studentId),
        inArray(homework.id, ids),
        eq(homeworkSubmission.isCurrent, true),
      ),
    );
  const found: StageHomework[] = [];
  for (const { submissionId } of current) {
    const submission = await findSubmission(db, teacherId, submissionId);
    if (!submission) continue;
    found.push({
      id: submission.homeworkId,
      title: submission.title,
      correct: submission.correct,
      wrong: submission.wrong,
      pending: submission.pending,
      // shortcut: pictures of options and by gaps are not shown on the stage yet, only their text; add them with the stage's design (#153)
      tasks: submission.tasks.map((t) => ({
        index: t.index,
        prompt: t.prompt,
        passage: t.passage,
        answer: t.answer,
        verdict: t.verdict,
        key: t.key,
        sentences: t.sentences?.map((s) => ({ answer: s.answer, key: s.key, verdict: s.verdict })) ?? null,
        file: t.file,
      })),
    });
  }
  return found;
}
