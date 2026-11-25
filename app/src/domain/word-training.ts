// The daily word training (#238): which words are due, which exercise a word
// gets, and how an answer moves it. Plain data and functions only: the server
// applies them in one statement, the screen shows the exercises.
//
// A right answer on a day the word is due moves it on: it comes back in 1, 2,
// 4, 8, then 16 days. A wrong answer brings it back tomorrow, from the start.
// Five right answers in a row, each on a day it was due, so on different
// days: the word «закрепилось». Dates are the student's, in their time zone.

/** Days until the word is due again after the 1st, 2nd… 5th right answer in a row. */
export const INTERVAL_DAYS = [1, 2, 4, 8, 16] as const;
/** The step at which a word counts as learnt. */
export const MASTERED_STEP = INTERVAL_DAYS.length;
/** At most this many words in one training. */
export const SESSION_WORDS = 15;
/** A choice is out of this many options; with fewer words to choose from, the child types. */
export const CHOICE_OPTIONS = 4;

/**
 * The exercises, easiest first. A new type goes here and in exerciseFor();
 * the schedule does not change.
 */
export const EXERCISE_TYPES = ["choose_translation", "choose_word", "fill_gap", "type_word"] as const;
export type ExerciseType = (typeof EXERCISE_TYPES)[number];

/** The step at which a word with an example comes as «Вставь слово в предложение» (#239). */
export const GAP_STEP = 2;
/** What stands for the word in its example. */
export const GAP = "___";

/**
 * A new word starts with choosing its translation, then its word, then typing
 * it; typing when there is nothing to choose from. A word that can be a gap
 * in its example comes as one at `GAP_STEP`, and always in «Ещё разок»
 * (`extra`) — out of four words, or typed when there are too few (product
 * owner, 2026-11-21).
 */
export function exerciseFor(step: number, canChoose: boolean, canGap = false, extra = false): ExerciseType {
  if (canGap && (extra || step === GAP_STEP)) return "fill_gap";
  if (!canChoose) return "type_word";
  if (step <= 0) return "choose_translation";
  if (step === 1) return "choose_word";
  return "type_word";
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The example with the word as a gap: its first use as it is, case aside, and
 * not inside a longer word. Null when the example does not use the word so —
 * «go» in «She went home» — and then the word gets no gap (product owner,
 * 2026-11-21).
 */
export function gapSentence(example: string | null, word: string): string | null {
  const target = word.trim();
  if (!example || target === "") return null;
  const use = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(target).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, "iu");
  return use.test(example) ? example.replace(use, GAP) : null;
}

/** A word with no date is new: due now. */
export function isDue(dueOn: string | null, today: string): boolean {
  return dueOn === null || dueOn <= today;
}

/** A calendar date (YYYY-MM-DD) `days` later. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type WordState = { step: number; dueOn: string | null };

/**
 * The word after an answer. `counts` is false outside today's due words —
 * «Ещё разок», or a word answered again after it moved on: a right answer
 * then moves nothing, so a word is never learnt in one evening; a wrong one
 * still brings it back tomorrow.
 */
export function afterAnswer(state: WordState, right: boolean, today: string, counts: boolean): WordState {
  if (!right) return { step: 0, dueOn: addDays(today, 1) };
  if (!counts) return state;
  const step = Math.min(state.step + 1, MASTERED_STEP);
  return { step, dueOn: addDays(today, INTERVAL_DAYS[step - 1]!) };
}

export function isMastered(step: number): boolean {
  return step >= MASTERED_STEP;
}

/** What the teacher sees by a word (#240): learnt, missed more often than not, or still learning; nothing before its first training. */
export const WORD_MARKS = ["learnt", "often_wrong", "learning"] as const;
export type WordMark = (typeof WORD_MARKS)[number];
export const WORD_MARK_LABELS: Record<WordMark, string> = { learnt: "закрепилось", often_wrong: "часто ошибается", learning: "учится" };

export function wordMark(word: { step: number; rightCount: number; wrongCount: number; trained: boolean }): WordMark | null {
  // A word missed in homework (#284) is marked even before its first training.
  if (!word.trained) return word.wrongCount > word.rightCount ? "often_wrong" : null;
  if (isMastered(word.step)) return "learnt";
  if (word.wrongCount > word.rightCount) return "often_wrong";
  return "learning";
}

/**
 * The English word «Послушать» plays in an exercise (#323), where it does not
 * give the answer away: the prompt of «Как переводится …?» at once; on the
 * others the word, once answered (`correct` is the right answer then). Null
 * while it would give the answer away.
 */
export function spokenWord(type: ExerciseType, prompt: string, correct: string | null): string | null {
  if (type === "choose_translation") return prompt;
  return correct;
}
