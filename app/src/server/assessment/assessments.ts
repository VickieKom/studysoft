// The monthly skills assessment on the card (#252): imported as a draft in
// the assessment format, corrected by the teacher — a question removed, the
// recording for «Аудирование» and the picture for «Говорение» uploaded — and
// approved, after which it does not change. The keys stay in the stored
// document; screens get `assessmentView` only. The teacher's only.
import { and, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { type AssessmentDocument, type AssessmentSkill, needsRecording, withoutQuestion } from "../../domain/assessment-format";
import type { Database } from "../db/client";
import { assessment, vocabularyWord } from "../db/schema";

export type AssessmentRow = {
  id: string;
  studentId: string;
  title: string;
  status: "draft" | "approved";
  document: AssessmentDocument;
  listeningRecording: string | null;
  speakingPicture: string | null;
  createdAt: Date;
};

const columns = {
  id: assessment.id,
  studentId: assessment.studentId,
  title: assessment.title,
  status: assessment.status,
  document: assessment.document,
  listeningRecording: assessment.listeningRecording,
  speakingPicture: assessment.speakingPicture,
  createdAt: assessment.createdAt,
};

const toRow = (r: Omit<AssessmentRow, "status" | "document"> & { status: string; document: unknown }): AssessmentRow => ({
  ...r,
  status: r.status as AssessmentRow["status"],
  document: r.document as AssessmentDocument,
});

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

/** «Убрать»: the draft without one question (see `removeQuestionFrom`). */
export async function removeQuestion(
  db: Database,
  teacherId: string,
  assessmentId: string,
  skill: AssessmentSkill,
  index: number,
): Promise<"ok" | "not_found" | "not_removable" | "changed"> {
  const found = await findAssessment(db, teacherId, assessmentId);
  return found ? removeQuestionFrom(db, teacherId, found, skill, index) : "not_found";
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
    .set({ document: next, updatedAt: new Date() })
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
 * is a draft and that it has its recording when it has «Аудирование».
 */
export async function approveAssessment(db: Database, teacherId: string, assessmentId: string, retry = true): Promise<"ok" | "not_found" | "no_recording"> {
  const rows = await db
    .update(assessment)
    .set({ status: "approved", approvedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(assessment.id, assessmentId),
        eq(assessment.teacherId, teacherId),
        eq(assessment.status, "draft"),
        or(isNotNull(assessment.listeningRecording), sql`NOT (${assessment.document} -> 'sections' @> '[{"skill":"listening"}]'::jsonb)`),
      ),
    )
    .returning({ id: assessment.id });
  if (rows.length > 0) return "ok";
  const found = await findAssessment(db, teacherId, assessmentId);
  if (!found) return "not_found";
  // Approved already: nothing to do.
  if (found.status === "approved") return "ok";
  if (needsRecording(found.document) && !found.listeningRecording) return "no_recording";
  // The recording came between the statement and the read: once more.
  return retry ? approveAssessment(db, teacherId, assessmentId, false) : "no_recording";
}
