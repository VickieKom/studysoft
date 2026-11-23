// The child's answers to the monthly assessment (#253): plain data and pure
// functions shared by the page and the server. The server keeps the answers
// and scores them (`server/assessment/scoring.ts`); the page sends one
// answer at a time and never gets a key or a score.
import { type AssessmentDocument, type AssessmentSkill, TRUE_FALSE } from "./assessment-format";

/** «Аудирование» plays at most this many times for the child (product owner, 2026-11-22). */
export const MAX_LISTENING_PLAYS = 2;
/** The longest answer to a «Лексика» question, in characters. */
export const MAX_WORD_ANSWER = 200;
/** The longest «Письмо», in characters. */
export const MAX_WRITING_ANSWER = 3000;
/** The speaking recording made on the teacher's panel is at most 5 minutes, as a homework voice answer. */
export const MAX_SPEAKING_SECONDS = 5 * 60;

/** The sections the server checks itself; «Письмо» and «Говорение» are scored by the teacher (#254). */
export const AUTO_SECTIONS = ["listening", "reading", "grammar", "vocabulary"] as const satisfies readonly AssessmentSkill[];
export type AutoSkill = (typeof AUTO_SECTIONS)[number];

/**
 * One answer per question of a section, by position: an option's number as
 * text for a choice or a gap, `true` / `false` / `not_given`, the typed word,
 * or the text of «Письмо» at position 0. Null is not answered.
 */
export type AssessmentAnswers = Partial<Record<AssessmentSkill, (string | null)[]>>;

/** A section's score: right of all its questions, an unanswered one wrong. */
export type SectionScore = { right: number; total: number };
export type AutoScores = Partial<Record<AutoSkill, SectionScore>>;

/** How many answers a section takes; none for «Говорение», answered live. */
export function answerSlots(document: AssessmentDocument, skill: AssessmentSkill): number {
  const section = document.sections.find((s) => s.skill === skill);
  if (!section) return 0;
  switch (section.skill) {
    case "listening":
    case "reading":
    case "vocabulary":
      return section.questions.length;
    case "grammar":
      return section.gaps.length;
    case "writing":
      return 1;
    case "speaking":
      return 0;
  }
}

const optionNumber = (value: string, count: number) => /^\d+$/.test(value) && Number(value) < count;

/**
 * Whether `value` may answer this question: an option that exists, one of
 * the true / false / not given, or text within its limit. Null clears it.
 */
export function validAnswer(document: AssessmentDocument, skill: AssessmentSkill, index: number, value: string | null): boolean {
  const section = document.sections.find((s) => s.skill === skill);
  if (!section || !Number.isInteger(index) || index < 0 || index >= answerSlots(document, skill)) return false;
  if (value === null) return true;
  switch (section.skill) {
    case "listening":
      return optionNumber(value, section.questions[index]!.options.length);
    case "reading": {
      const question = section.questions[index]!;
      return question.type === "true_false" ? (TRUE_FALSE as readonly string[]).includes(value) : optionNumber(value, question.options.length);
    }
    case "grammar":
      return optionNumber(value, section.gaps[index]!.options.length);
    case "vocabulary":
      return value.length <= MAX_WORD_ANSWER;
    case "writing":
      return value.length <= MAX_WRITING_ANSWER;
    case "speaking":
      return false;
  }
}

/** The answers with one of them set: positions before it filled with null. */
export function withAnswer(answers: AssessmentAnswers, skill: AssessmentSkill, index: number, value: string | null): AssessmentAnswers {
  const list = [...(answers[skill] ?? [])];
  while (list.length <= index) list.push(null);
  list[index] = value;
  return { ...answers, [skill]: list };
}

/** Whether the child answered anything in a section. A section not started is not scored (#253). */
export function started(answers: AssessmentAnswers, skill: AssessmentSkill): boolean {
  return (answers[skill] ?? []).some((value) => value !== null && value.trim() !== "");
}
