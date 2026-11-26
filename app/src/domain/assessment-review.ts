// Scoring the monthly assessment (#254): «Письмо» and «Говорение» by the
// teacher, by the same three criteria every month, so assessments compare
// across months; the other sections by the automatic check (#253). Plain data
// and pure functions shared by the card and the server.
import { z } from "zod";
import type { AutoScores } from "./assessment-answers";
import { ASSESSMENT_SECTIONS, type AssessmentSkill } from "./assessment-format";

/** The sections the teacher scores. */
export const CRITERIA_SECTIONS = ["writing", "speaking"] as const satisfies readonly AssessmentSkill[];
export type CriteriaSection = (typeof CRITERIA_SECTIONS)[number];

/** The three criteria, in this order (product owner, 2026-11-22). */
export const CRITERIA = ["task", "coherence", "language"] as const;
export const CRITERION_LABELS: Record<(typeof CRITERIA)[number], string> = {
  task: "Решение задачи",
  coherence: "Связность",
  language: "Язык",
};

/** A criterion's score, 0 to 2. */
export const CRITERION_SCORES = [0, 1, 2] as const;
export const CRITERION_SCORE_LABELS: Record<(typeof CRITERION_SCORES)[number], string> = {
  0: "0 — не справился",
  1: "1 — частично",
  2: "2 — справился",
};

/** One section's scores: one per criterion, in `CRITERIA` order. */
export const sectionCriteriaSchema = z.array(z.number().int().min(0).max(2)).length(CRITERIA.length);
export type SectionCriteria = z.infer<typeof sectionCriteriaSchema>;
export const criteriaScoresSchema = z.object({ writing: sectionCriteriaSchema.optional(), speaking: sectionCriteriaSchema.optional() }).strict();
export type CriteriaScores = z.infer<typeof criteriaScoresSchema>;

/** The most a section scores by the criteria. */
const MAX_CRITERIA = CRITERIA.length * 2;

/** A scored section's percent: the sum of its criteria of six. */
export function criteriaPercent(scores: SectionCriteria): number {
  return Math.round((scores.reduce((sum, s) => sum + s, 0) / MAX_CRITERIA) * 100);
}

/** Whether the teacher scored every section of `skills` that she scores. */
export function criteriaComplete(skills: readonly AssessmentSkill[], criteria: CriteriaScores): boolean {
  return CRITERIA_SECTIONS.every((section) => !skills.includes(section) || criteria[section] !== undefined);
}

/**
 * The percent of each of the assessment's skills that has one, in the
 * format's order: an auto-checked section right of all, when the child
 * started it; «Письмо» and «Говорение» once the teacher scored them. A
 * section not started or not scored has none.
 */
export function skillPercents(
  skills: readonly AssessmentSkill[],
  auto: AutoScores,
  criteria: CriteriaScores,
): { skill: AssessmentSkill; percent: number }[] {
  return ASSESSMENT_SECTIONS.filter((skill) => skills.includes(skill)).flatMap((skill): { skill: AssessmentSkill; percent: number }[] => {
    if (skill === "writing" || skill === "speaking") {
      const scored = criteria[skill];
      return scored ? [{ skill, percent: criteriaPercent(scored) }] : [];
    }
    const score = auto[skill];
    return score && score.total > 0 ? [{ skill, percent: Math.round((score.right / score.total) * 100) }] : [];
  });
}
