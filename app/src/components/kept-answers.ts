import type { AssessmentAnswers } from "@/domain/assessment-answers";
import type { AssessmentSkill } from "@/domain/assessment-format";

/**
 * How long after its save an answer kept in the browser may still be missing
 * from a page a reload rendered: about the time a reload takes (#412). An
 * older one the server has another value for was changed since, on another
 * device or in a later lesson, and is not sent over it.
 */
export const RELOAD_WINDOW_MS = 60_000;

/** An answer kept in this browser; `savedAt` once the server confirmed it (#399). */
export type KeptAnswer = { skill: AssessmentSkill; index: number; value: string | null; savedAt?: number };
export type KeptAnswers = Record<string, KeptAnswer>;

/**
 * The kept answers to show and send again when the page opens: every one not
 * confirmed, and a confirmed one the page does not have that was saved within
 * the reload window, since the page was then rendered before its save. The
 * rest are done with.
 */
export function keptOnOpen(kept: KeptAnswers, loaded: AssessmentAnswers, now: number): KeptAnswers {
  return Object.fromEntries(
    Object.entries(kept).filter(([, entry]) => {
      if (entry.savedAt === undefined) return true;
      const shown = (loaded[entry.skill]?.[entry.index] ?? null) === entry.value;
      return !shown && now - entry.savedAt < RELOAD_WINDOW_MS;
    }),
  );
}
