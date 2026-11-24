// The monthly skills assessment on the card (#252): imported as a draft in
// the assessment format, corrected by the teacher — a question removed, the
// recording for «Аудирование» and the picture for «Говорение» uploaded — and
// approved, after which it does not change. The keys stay in the stored
// document; screens get `assessmentView` only. The teacher's only.
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, max, or, sql } from "drizzle-orm";
import { type AssessmentDocument, type AssessmentSkill, needsRecording, withoutQuestion } from "../../domain/assessment-format";
import type { Database } from "../db/client";
import { orderedLessons, studentWithTextbook } from "../lesson/prep";
import { assessment, lesson, vocabularyWord } from "../db/schema";

export type AssessmentRow = {
  id: string;
  studentId: string;
  title: string;
  status: "draft" | "approved";
  /** Saved by the assistant (#313), shown «от ассистента». */
  fromAssistant: boolean;
  document: AssessmentDocument;
  listeningRecording: string | null;
  speakingPicture: string | null;
  /** The version of the document the teacher's page has seen (#313); see `revision`. */
  revision: string;
  /** Taken in a lesson (#253). */
  openUntil: Date | null;
  speakingRecording: string | null;
  submittedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
};

/**
 * The version of an assessment's document, as the teacher's page has seen it
 * (#313, like the homework's in #99): the text of jsonb is canonical, so the
 * same content always gives the same revision. «Убрать» and «Утвердить» send
 * it back and are refused when the draft changed meanwhile, for instance
 * because the assistant replaced it.
 */
const revision = sql<string>`md5(${assessment.document}::text)`;

const columns = {
  id: assessment.id,
  studentId: assessment.studentId,
  title: assessment.title,
  status: assessment.status,
  createdBy: assessment.createdBy,
  document: assessment.document,
  listeningRecording: assessment.listeningRecording,
  speakingPicture: assessment.speakingPicture,
  revision,
  openUntil: assessment.openUntil,
  speakingRecording: assessment.speakingRecording,
  submittedAt: assessment.submittedAt,
  finishedAt: assessment.finishedAt,
  createdAt: assessment.createdAt,
};

const toRow = ({
  createdBy,
  ...r
}: Omit<AssessmentRow, "status" | "document" | "fromAssistant"> & { status: string; createdBy: string; document: unknown }): AssessmentRow => ({
  ...r,
  status: r.status as AssessmentRow["status"],
  fromAssistant: createdBy === "agent",
  document: r.document as AssessmentDocument,
});

/** The longest assessment as JSON, imported by the teacher or saved by the assistant: text only, its files are uploaded on the card. */
export const MAX_ASSESSMENT_LENGTH = 200_000;

/** The teacher's first action on a draft (#313): kept once set, so the assistant's next save makes a new draft. */
export const TEACHER_EDITED = sql`coalesce(${assessment.teacherEditedAt}, now())`;

/** The student's assessments, the newest first. */
export async function listAssessments(db: Database, teacherId: string, studentId: string): Promise<AssessmentRow[]> {
  const rows = await db
    .select(columns)
    .from(assessment)
    .where(and(eq(assessment.teacherId, teacherId), eq(assessment.studentId, studentId)))
    .orderBy(desc(assessment.createdAt), desc(assessment.id));
  return rows.map(toRow);
}

export async function findAssessment(db: Database, teacherId: string, assessmentId: string): Promise<AssessmentRow | null> {
  const [row] = await db
    .select(columns)
    .from(assessment)
    .where(and(eq(assessment.id, assessmentId), eq(assessment.teacherId, teacherId)));
  return row ? toRow(row) : null;
}

/**
 * Keeps a «Лексика» question's link to a vocabulary word only when the word
 * is the student's: a pasted id of another student's word, or of none, is
 * dropped and the question stays.
 */
async function ownWords(db: Database, teacherId: string, studentId: string, document: AssessmentDocument): Promise<AssessmentDocument> {
  const vocabulary = document.sections.find((s) => s.skill === "vocabulary");
  const named = vocabulary?.skill === "vocabulary" ? vocabulary.questions.flatMap((q) => (q.vocabularyWord ? [q.vocabularyWord] : [])) : [];
  if (!vocabulary || vocabulary.skill !== "vocabulary" || named.length === 0) return document;
  const rows = await db
    .select({ id: vocabularyWord.id })
    .from(vocabularyWord)
    .where(and(eq(vocabularyWord.teacherId, teacherId), eq(vocabularyWord.studentId, studentId), inArray(vocabularyWord.id, named)));
  const known = new Set(rows.map((r) => r.id));
  const questions = vocabulary.questions.map((q) => {
    if (!q.vocabularyWord || known.has(q.vocabularyWord)) return q;
    const { vocabularyWord: _dropped, ...rest } = q;
    return rest as typeof q;
  });
  return { ...document, sections: document.sections.map((s) => (s === vocabulary ? { ...vocabulary, questions } : s)) };
}

/** «Импортировать»: a valid assessment saved as the student's draft. */
export async function importAssessment(db: Database, teacherId: string, studentId: string, document: AssessmentDocument): Promise<string> {
  const kept = await ownWords(db, teacherId, studentId, document);
  const [row] = await db.insert(assessment).values({ teacherId, studentId, title: kept.title, document: kept }).returning({ id: assessment.id });
  return row!.id;
}

/**
 * «Убрать»: the draft without one question (see `removeQuestionFrom`), refused
 * as "changed" when the draft is no longer the version the page has seen: the
 * index is a question of that version.
 */
export async function removeQuestion(
  db: Database,
  teacherId: string,
  assessmentId: string,
  seen: string,
  skill: AssessmentSkill,
  index: number,
): Promise<"ok" | "not_found" | "not_removable" | "changed"> {
  const found = await findAssessment(db, teacherId, assessmentId);
  if (!found) return "not_found";
  if (found.revision !== seen) return "changed";
  return removeQuestionFrom(db, teacherId, found, skill, index);
}

/**
 * The removal against the assessment as it was read. The write is
 * conditional on that document and on the draft still being a draft, so an
 * approval or another removal in between is never undone.
 */
export async function removeQuestionFrom(
  db: Database,
  teacherId: string,
  found: AssessmentRow,
  skill: AssessmentSkill,
  index: number,
): Promise<"ok" | "not_removable" | "changed"> {
  if (found.status !== "draft") return "changed";
  const next = withoutQuestion(found.document, skill, index);
  if (!next) return "not_removable";
  const rows = await db
    .update(assessment)
    .set({ document: next, teacherEditedAt: TEACHER_EDITED, updatedAt: new Date() })
    .where(
      and(
        eq(assessment.id, found.id),
        eq(assessment.teacherId, teacherId),
        eq(assessment.status, "draft"),
        sql`${assessment.document} = ${JSON.stringify(found.document)}::jsonb`,
      ),
    )
    .returning({ id: assessment.id });
  return rows.length > 0 ? "ok" : "changed";
}

/**
 * «Утвердить»: the draft is approved and fixed. One statement checks that it
 * is a draft, that it is still the version the teacher's page has seen (#313:
 * the assistant may have replaced it since), and that it has its recording
 * when it has «Аудирование».
 */
export async function approveAssessment(
  db: Database,
  teacherId: string,
  assessmentId: string,
  seen: string,
  retry = true,
): Promise<"ok" | "not_found" | "changed" | "no_recording"> {
  const rows = await db
    .update(assessment)
    .set({ status: "approved", approvedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(assessment.id, assessmentId),
        eq(assessment.teacherId, teacherId),
        eq(assessment.status, "draft"),
        eq(revision, seen),
        or(isNotNull(assessment.listeningRecording), sql`NOT (${assessment.document} -> 'sections' @> '[{"skill":"listening"}]'::jsonb)`),
      ),
    )
    .returning({ id: assessment.id });
  if (rows.length > 0) return "ok";
  const found = await findAssessment(db, teacherId, assessmentId);
  if (!found) return "not_found";
  // Approved already: nothing to do.
  if (found.status === "approved") return "ok";
  if (found.revision !== seen) return "changed";
  if (needsRecording(found.document) && !found.listeningRecording) return "no_recording";
  // The recording came between the statement and the read: once more.
  return retry ? approveAssessment(db, teacherId, assessmentId, seen, false) : "no_recording";
}

/**
 * The assistant's draft for a student (#313), validated like an import:
 * replaces the assistant's latest draft while the teacher has done nothing
 * to it, otherwise a new draft. One conditional statement replaces it: the
 * teacher's actions set `teacherEditedAt` on the row, and an update that
 * waited for one of them sees it and replaces nothing. Returns the draft's id.
 */
export async function saveAssistantAssessment(
  db: Database,
  teacherId: string,
  studentId: string,
  document: AssessmentDocument,
  context: { assessmentPeriod: AssessmentPeriod },
): Promise<string> {
  const kept = await ownWords(db, teacherId, studentId, document);
  const untouched = and(
    eq(assessment.teacherId, teacherId),
    eq(assessment.studentId, studentId),
    eq(assessment.status, "draft"),
    eq(assessment.createdBy, "agent"),
    isNull(assessment.teacherEditedAt),
  );
  const latest = db
    .select({ id: assessment.id })
    .from(assessment)
    .where(untouched)
    .orderBy(desc(assessment.createdAt), desc(assessment.id))
    .limit(1);
  const [replaced] = await db
    .update(assessment)
    .set({ title: kept.title, document: kept, context, updatedAt: new Date() })
    .where(and(inArray(assessment.id, latest), untouched))
    .returning({ id: assessment.id });
  if (replaced) return replaced.id;
  const [created] = await db
    .insert(assessment)
    .values({ teacherId, studentId, title: kept.title, document: kept, createdBy: "agent", context })
    .returning({ id: assessment.id });
  return created!.id;
}

/** Without an approved assessment, the period of the next one is the last 30 days. */
export const FIRST_PERIOD_DAYS = 30;

export type AssessmentPeriod = {
  lastAssessmentAt: Date | null;
  since: Date;
  coveredUnits: { unit: string; heldAt: Date }[];
  words: { id: string; word: string; translation: string | null }[];
};

/**
 * What the assistant drafts the next assessment from (#313): the period
 * since the student's last approved assessment, or the last 30 days without
 * one; the lessons of the student's textbook covered in it, oldest first;
 * and the words added to the vocabulary in it.
 *
 * A covered lesson is a held lesson whose unit is a lesson of the student's
 * textbook, as «Завершить урок» writes it (#154). What the teacher typed in
 * «Юнит» when marking a lesson by hand is hers alone and never reaches the
 * assistant (#82), so any other text there is left out.
 */
export async function assessmentPeriod(db: Database, teacherId: string, studentId: string, now: Date = new Date()): Promise<AssessmentPeriod> {
  const [last] = await db
    .select({ at: max(assessment.approvedAt) })
    .from(assessment)
    .where(and(eq(assessment.teacherId, teacherId), eq(assessment.studentId, studentId), eq(assessment.status, "approved")));
  const lastAssessmentAt = last?.at ?? null;
  const since = lastAssessmentAt ?? new Date(now.getTime() - FIRST_PERIOD_DAYS * 86_400_000);
  const units = await db
    .select({ unit: lesson.unit, heldAt: lesson.startsAt })
    .from(lesson)
    .where(
      and(
        eq(lesson.teacherId, teacherId),
        eq(lesson.studentId, studentId),
        eq(lesson.status, "held"),
        isNotNull(lesson.unit),
        gte(lesson.startsAt, since),
      ),
    )
    .orderBy(asc(lesson.startsAt));
  const book = await studentWithTextbook(db, teacherId, studentId);
  const bookLessons = new Set(orderedLessons(book?.structure ?? null).map((l) => l.label));
  const words = await db
    .select({ id: vocabularyWord.id, word: vocabularyWord.word, translation: vocabularyWord.translation })
    .from(vocabularyWord)
    .where(and(eq(vocabularyWord.teacherId, teacherId), eq(vocabularyWord.studentId, studentId), gte(vocabularyWord.createdAt, since)))
    .orderBy(asc(vocabularyWord.createdAt), asc(vocabularyWord.word));
  return { lastAssessmentAt, since, coveredUnits: units.filter((u) => bookLessons.has(u.unit!)).map((u) => ({ unit: u.unit!, heldAt: u.heldAt })), words };
}
