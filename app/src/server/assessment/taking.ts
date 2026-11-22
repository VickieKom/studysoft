// The monthly assessment taken in a lesson (#253). While a lesson with the
// student is going on, the teacher opens an approved assessment to them,
// until that lesson's end; opened again in a later lesson, the child goes on
// with the answers they gave. The child answers one question at a time,
// plays «Аудирование» at most twice, and ends with «Сдать»; the teacher may
// end it instead with «Завершить замер». Either fixes the answers and scores
// the auto-checked sections; a wrong «Лексика» answer brings its word back
// into the word training. The child never gets a key, a score or the
// speaking recording: what they read is `childView`.
import { and, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { MAX_LISTENING_PLAYS, type AssessmentAnswers, validAnswer, withAnswer } from "../../domain/assessment-answers";
import type { AssessmentDocument, AssessmentSkill } from "../../domain/assessment-format";
import { todayIn } from "../../domain/homework";
import { addDays } from "../../domain/word-training";
import type { Database } from "../db/client";
import { assessment, lesson, student, vocabularyWord } from "../db/schema";
import { LIVE_LESSON } from "../library/student-games";
import { autoScores, missedWords } from "./scoring";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Open to the child at `now`: approved, opened in a lesson that has not ended, not finished by the teacher. */
const openToChild = (teacherId: string, studentId: string, now: Date) =>
  and(
    eq(assessment.teacherId, teacherId),
    eq(assessment.studentId, studentId),
    eq(assessment.status, "approved"),
    gt(assessment.openUntil, now),
    isNull(assessment.finishedAt),
  );

/**
 * «Открыть ученику»: the approved assessment, not yet ended, opened to its
 * student while a lesson of theirs is going on, until that lesson's end;
 * opened again later, the access moves on, never back. One statement checks
 * the assessment and the lesson and writes the access. Returns when it
 * closes, or why nothing was opened.
 */
export async function openAssessmentToStudent(
  db: Database,
  teacherId: string,
  assessmentId: string,
  now: Date = new Date(),
): Promise<{ until: Date } | "not_found" | "not_approved" | "ended" | "no_lesson"> {
  const rows = await db.execute<{ until: string | Date }>(sql`
    UPDATE assessment AS a
    SET open_lesson_id = l.id,
        open_until = GREATEST(COALESCE(a.open_until, l.starts_at), l.starts_at + l.duration_minutes * interval '1 minute'),
        updated_at = now()
    FROM (
      SELECT l.id, l.starts_at, l.duration_minutes
      FROM lesson AS l
      JOIN assessment AS x ON x.id = ${assessmentId} AND x.student_id = l.student_id AND x.teacher_id = l.teacher_id
      WHERE l.teacher_id = ${teacherId}
        AND ${LIVE_LESSON}
        AND l.starts_at <= ${now.toISOString()}
        AND l.starts_at + l.duration_minutes * interval '1 minute' > ${now.toISOString()}
      ORDER BY l.starts_at DESC
      LIMIT 1
    ) AS l
    WHERE a.id = ${assessmentId}
      AND a.teacher_id = ${teacherId}
      AND a.status = 'approved'
      AND a.submitted_at IS NULL
      AND a.finished_at IS NULL
    RETURNING a.open_until AS until
  `);
  const [row] = [...rows];
  if (row) return { until: new Date(row.until) };
  const [found] = await db
    .select({ status: assessment.status, submittedAt: assessment.submittedAt, finishedAt: assessment.finishedAt })
    .from(assessment)
    .where(and(eq(assessment.id, assessmentId), eq(assessment.teacherId, teacherId)));
  if (!found) return "not_found";
  if (found.status !== "approved") return "not_approved";
  if (found.submittedAt || found.finishedAt) return "ended";
  return "no_lesson";
}

/** The assessments open to this student at `now`, the newest first: for «Материалы урока». */
export async function studentAssessments(db: Database, teacherId: string, studentId: string, now: Date = new Date()) {
  return db
    .select({ id: assessment.id, title: assessment.title })
    .from(assessment)
    .where(openToChild(teacherId, studentId, now))
    .orderBy(sql`${assessment.openUntil} DESC`, assessment.id);
}

export type TakenRow = {
  id: string;
  title: string;
  document: AssessmentDocument;
  answers: AssessmentAnswers;
  listeningPlays: number;
  hasRecording: boolean;
  hasPicture: boolean;
  submitted: boolean;
};

/** One assessment open to this student, or null: missing, not opened, closed and another's are the same. */
export async function studentAssessment(db: Database, teacherId: string, studentId: string, id: string, now: Date = new Date()): Promise<TakenRow | null> {
  const [row] = await db
    .select({
      id: assessment.id,
      title: assessment.title,
      document: assessment.document,
      answers: assessment.answers,
      listeningPlays: assessment.listeningPlays,
      recording: assessment.listeningRecording,
      picture: assessment.speakingPicture,
      submittedAt: assessment.submittedAt,
    })
    .from(assessment)
    .where(and(openToChild(teacherId, studentId, now), eq(assessment.id, id)));
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    document: row.document as AssessmentDocument,
    answers: row.answers as AssessmentAnswers,
    listeningPlays: row.listeningPlays,
    hasRecording: row.recording !== null,
    hasPicture: row.picture !== null,
    submitted: row.submittedAt !== null,
  };
}

/** The assessment open to the child, locked for a write: still to be handed in. */
async function lockedOpen(tx: Tx, teacherId: string, studentId: string, id: string, now: Date) {
  const [row] = await tx
    .select({ document: assessment.document, answers: assessment.answers })
    .from(assessment)
    .where(and(openToChild(teacherId, studentId, now), eq(assessment.id, id), isNull(assessment.submittedAt)))
    .for("update");
  return row ? { document: row.document as AssessmentDocument, answers: row.answers as AssessmentAnswers } : null;
}

/**
 * One answer of the child, kept as they go: the row is locked while the
 * answer is set, so two answers sent at once both stay.
 */
export async function saveAnswer(
  db: Database,
  teacherId: string,
  studentId: string,
  id: string,
  skill: AssessmentSkill,
  index: number,
  value: string | null,
  now: Date = new Date(),
): Promise<"ok" | "not_found" | "invalid"> {
  return db.transaction(async (tx) => {
    const open = await lockedOpen(tx, teacherId, studentId, id, now);
    if (!open) return "not_found";
    if (!validAnswer(open.document, skill, index, value)) return "invalid";
    await tx
      .update(assessment)
      .set({ answers: withAnswer(open.answers, skill, index, value), updatedAt: now })
      .where(eq(assessment.id, id));
    return "ok";
  });
}

/**
 * The child starts «Аудирование»: counted on the server, so a reload or a
 * later lesson gives no more plays. One conditional statement. Returns the
 * plays used, or null when no play is left or nothing is open.
 */
export async function startListening(db: Database, teacherId: string, studentId: string, id: string, now: Date = new Date()): Promise<number | null> {
  const [row] = await db
    .update(assessment)
    .set({ listeningPlays: sql`${assessment.listeningPlays} + 1`, updatedAt: now })
    .where(
      and(
        openToChild(teacherId, studentId, now),
        eq(assessment.id, id),
        isNull(assessment.submittedAt),
        isNotNull(assessment.listeningRecording),
        sql`${assessment.listeningPlays} < ${MAX_LISTENING_PLAYS}`,
      ),
    )
    .returning({ plays: assessment.listeningPlays });
  return row ? row.plays : null;
}

/** Whether the child may still fetch the recording of «Аудирование»: open, and the plays not over the limit. */
export async function listeningOpenToChild(db: Database, teacherId: string, studentId: string, id: string, now: Date = new Date()): Promise<string | null> {
  const [row] = await db
    .select({ blob: assessment.listeningRecording })
    .from(assessment)
    .where(
      and(
        openToChild(teacherId, studentId, now),
        eq(assessment.id, id),
        isNull(assessment.submittedAt),
        sql`${assessment.listeningPlays} <= ${MAX_LISTENING_PLAYS}`,
      ),
    );
  return row?.blob ?? null;
}

/**
 * The words the child missed in «Лексика» come back into the training, as a
 * mistake in homework does: one mistake more towards «часто ошибается»,
 * from the first interval again, due tomorrow in the student's time zone —
 * unless due by then already, or new.
 */
// shortcut: the same write as homework's `missedInHomework` (#284), which is not on main yet; use it once #284 lands (#253)
async function missedInAssessment(tx: Tx, teacherId: string, studentId: string, ids: string[], now: Date) {
  if (ids.length === 0) return;
  const [row] = await tx
    .select({ timeZone: student.timeZone })
    .from(student)
    .where(and(eq(student.id, studentId), eq(student.teacherId, teacherId)));
  if (!row) return;
  const tomorrow = addDays(todayIn(row.timeZone, now), 1);
  await tx
    .update(vocabularyWord)
    .set({
      wrongCount: sql`${vocabularyWord.wrongCount} + 1`,
      trainStep: 0,
      dueOn: sql`CASE WHEN ${vocabularyWord.dueOn} IS NULL OR ${vocabularyWord.dueOn} <= ${tomorrow} THEN ${vocabularyWord.dueOn} ELSE ${tomorrow}::date END`,
      updatedAt: now,
    })
    .where(and(eq(vocabularyWord.teacherId, teacherId), eq(vocabularyWord.studentId, studentId), inArray(vocabularyWord.id, ids)));
}

/** «Сдать»: the child hands it in. The answers are fixed and scored; nothing of it goes back to the child. */
export async function submitAssessment(db: Database, teacherId: string, studentId: string, id: string, now: Date = new Date()): Promise<boolean> {
  return db.transaction(async (tx) => {
    const open = await lockedOpen(tx, teacherId, studentId, id, now);
    if (!open) return false;
    await tx.update(assessment).set({ submittedAt: now, scores: autoScores(open.document, open.answers), updatedAt: now }).where(eq(assessment.id, id));
    await missedInAssessment(tx, teacherId, studentId, missedWords(open.document, open.answers), now);
    return true;
  });
}

/**
 * «Завершить замер»: the teacher ends an approved assessment the child has
 * not handed in. An unanswered question counts as wrong, a section not
 * started is not scored. It closes for the child at once.
 */
export async function finishAssessment(db: Database, teacherId: string, id: string, now: Date = new Date()): Promise<"ok" | "not_found" | "ended"> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        studentId: assessment.studentId,
        status: assessment.status,
        document: assessment.document,
        answers: assessment.answers,
        submittedAt: assessment.submittedAt,
        finishedAt: assessment.finishedAt,
      })
      .from(assessment)
      .where(and(eq(assessment.id, id), eq(assessment.teacherId, teacherId)))
      .for("update");
    if (!row || row.status !== "approved") return "not_found";
    if (row.submittedAt || row.finishedAt) return "ended";
    const document = row.document as AssessmentDocument;
    const answers = row.answers as AssessmentAnswers;
    await tx
      .update(assessment)
      .set({ finishedAt: now, openUntil: null, scores: autoScores(document, answers), updatedAt: now })
      .where(eq(assessment.id, id));
    await missedInAssessment(tx, teacherId, row.studentId, missedWords(document, answers), now);
    return "ok";
  });
}

/** How far the child is, for the teacher: not opened, open now, handed in, ended by her. */
export const TAKING_STATUSES = ["not_opened", "open", "closed", "submitted", "finished"] as const;
export type TakingStatus = (typeof TAKING_STATUSES)[number];

export function takingStatus(row: { openUntil: Date | null; submittedAt: Date | null; finishedAt: Date | null }, now: Date = new Date()): TakingStatus {
  if (row.finishedAt) return "finished";
  if (row.submittedAt) return "submitted";
  if (!row.openUntil) return "not_opened";
  return row.openUntil > now ? "open" : "closed";
}

/** The picture of «Говорение» for the child while the assessment is open to them. */
export async function pictureOpenToChild(db: Database, teacherId: string, studentId: string, id: string, now: Date = new Date()): Promise<string | null> {
  const [row] = await db
    .select({ blob: assessment.speakingPicture })
    .from(assessment)
    .where(and(openToChild(teacherId, studentId, now), eq(assessment.id, id)));
  return row?.blob ?? null;
}

/** The student of this teacher's lesson, for «Замер» on the lesson panel; null when it is not hers. */
export async function lessonStudent(db: Database, teacherId: string, lessonId: string): Promise<string | null> {
  const [row] = await db.select({ studentId: lesson.studentId }).from(lesson).where(and(eq(lesson.id, lessonId), eq(lesson.teacherId, teacherId)));
  return row?.studentId ?? null;
}
