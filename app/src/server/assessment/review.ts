// The teacher's check of an ended assessment (#254): «Письмо» and «Говорение»
// scored by the three criteria, a percent per skill, and «Записать в
// прогресс», which writes the percents as the skill results (#255) of the day
// the assessment was ended, in the student's time zone, and freezes the
// scores (product owner, 2026-11-24). The teacher's only.
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { AutoScores } from "../../domain/assessment-answers";
import type { AssessmentDocument } from "../../domain/assessment-format";
import { type CriteriaScores, type CriteriaSection, criteriaComplete, type SectionCriteria, skillPercents } from "../../domain/assessment-review";
import { dateIn } from "../../domain/schedule";
import type { Database } from "../db/client";
import { assessment, skillResult, student } from "../db/schema";

/** The skills an assessment's document has sections for. */
const skillsOf = (document: unknown) => (document as AssessmentDocument).sections.map((s) => s.skill);

/** Why a score or a write is refused. */
export type ReviewRefusal = "not_found" | "not_ended" | "no_section" | "written" | "not_scored";

/**
 * Scores one section by the criteria. Only once the assessment is ended and
 * before «Записать в прогресс»: the write is conditional on both, so a score
 * that raced the write is refused.
 */
export async function scoreSection(
  database: Database,
  teacherId: string,
  assessmentId: string,
  section: CriteriaSection,
  scores: SectionCriteria,
): Promise<"scored" | ReviewRefusal> {
  const [row] = await database
    .select({ document: assessment.document, finishedAt: assessment.finishedAt, progressWrittenAt: assessment.progressWrittenAt })
    .from(assessment)
    .where(and(eq(assessment.id, assessmentId), eq(assessment.teacherId, teacherId)));
  if (!row) return "not_found";
  if (!row.finishedAt) return "not_ended";
  if (row.progressWrittenAt) return "written";
  if (!skillsOf(row.document).includes(section)) return "no_section";
  const updated = await database
    .update(assessment)
    .set({
      criteria: sql`coalesce(${assessment.criteria}, '{}'::jsonb) || ${JSON.stringify({ [section]: scores })}::jsonb`,
      updatedAt: new Date(),
    })
    .where(and(eq(assessment.id, assessmentId), eq(assessment.teacherId, teacherId), isNotNull(assessment.finishedAt), isNull(assessment.progressWrittenAt)))
    .returning({ id: assessment.id });
  return updated.length > 0 ? "scored" : "written";
}

/**
 * «Записать в прогресс»: the percents of a scored assessment become the skill
 * results of the day it was ended; a skill with no percent writes nothing,
 * and that day's results of the other skills stay. The assessment is locked
 * first, so the scores read are the ones written and two writes make one.
 */
export async function writeToProgress(database: Database, teacherId: string, assessmentId: string): Promise<{ date: string } | ReviewRefusal> {
  return database.transaction(async (tx) => {
    const [row] = await tx
      .select({
        studentId: assessment.studentId,
        document: assessment.document,
        scores: assessment.scores,
        criteria: assessment.criteria,
        finishedAt: assessment.finishedAt,
        progressWrittenAt: assessment.progressWrittenAt,
        timeZone: student.timeZone,
      })
      .from(assessment)
      .innerJoin(student, eq(student.id, assessment.studentId))
      .where(and(eq(assessment.id, assessmentId), eq(assessment.teacherId, teacherId)))
      .for("update", { of: assessment });
    if (!row) return "not_found";
    if (!row.finishedAt) return "not_ended";
    if (row.progressWrittenAt) return "written";
    const skills = skillsOf(row.document);
    const criteria = (row.criteria as CriteriaScores | null) ?? {};
    if (!criteriaComplete(skills, criteria)) return "not_scored";
    const date = dateIn(row.finishedAt, row.timeZone);
    for (const { skill, percent } of skillPercents(skills, (row.scores as AutoScores | null) ?? {}, criteria)) {
      // The unique key is on student, skill and date: the assessment's result replaces one entered by hand.
      await tx
        .insert(skillResult)
        .values({ teacherId, studentId: row.studentId, skill, percent, measuredOn: date })
        .onConflictDoUpdate({ target: [skillResult.studentId, skillResult.skill, skillResult.measuredOn], set: { percent, updatedAt: new Date() } });
    }
    await tx.update(assessment).set({ progressWrittenAt: new Date(), updatedAt: new Date() }).where(eq(assessment.id, assessmentId));
    return { date };
  });
}
