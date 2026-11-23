// The survey about the lessons (#332): its questions and answers, shared by
// the draft, the child's page and the server's validation. Plain data, zod and
// pure functions only.
import { z } from "zod";

export const BOTH_FUN = "Оба классные";
export const BOTH_MEH = "Оба так себе";
/** «Насколько понятно» is answered with three faces, the same for every child. */
export const CLARITY_FACES = ["могу объяснить", "почти понял", "пока путаюсь"] as const;
export const WISH_QUESTION = "А ещё я хочу…";
export const MORE_QUESTION = "Про что хочется ещё?";

/** At most this many pairs of materials and topics a survey asks about (product owner, 2026-11-23: topics at most three). */
export const MAX_PAIRS = 3;
export const MAX_TOPICS = 3;
export const MAX_OWN_QUESTIONS = 5;
export const MAX_QUESTION_LENGTH = 200;
export const MAX_TEXT_ANSWER_LENGTH = 1000;

const material = z.object({ id: z.uuid(), title: z.string().max(200) }).strict();

export const surveyQuestionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fun"), a: material, b: material }).strict(),
  z.object({ kind: z.literal("more"), topics: z.array(z.string().max(100)).min(2).max(MAX_TOPICS) }).strict(),
  z.object({ kind: z.literal("clear"), topic: z.string().max(100) }).strict(),
  z.object({ kind: z.literal("own"), text: z.string().min(1).max(MAX_QUESTION_LENGTH) }).strict(),
  z.object({ kind: z.literal("wish") }).strict(),
]);
export type SurveyQuestion = z.infer<typeof surveyQuestionSchema>;

/** A question as the child and the teacher read it. */
export function questionText(question: SurveyQuestion): string {
  switch (question.kind) {
    case "fun":
      return `Что было веселее: ${question.a.title} или ${question.b.title}?`;
    case "more":
      return MORE_QUESTION;
    case "clear":
      return `Насколько понятно: ${question.topic}?`;
    case "own":
      return question.text;
    case "wish":
      return WISH_QUESTION;
  }
}

/** The choices a question offers; none for a question answered with text. */
export function questionChoices(question: SurveyQuestion): string[] {
  switch (question.kind) {
    case "fun":
      return [question.a.title, question.b.title, BOTH_FUN, BOTH_MEH];
    case "more":
      return question.topics;
    case "clear":
      return [...CLARITY_FACES];
    case "own":
    case "wish":
      return [];
  }
}

/** One answer per question, in order: a choice the question offered, a text, or null for none. */
export const surveyAnswersSchema = z.array(z.string().max(MAX_TEXT_ANSWER_LENGTH).nullable());

/** Whether an answer fits its question: one of its choices, or any text for a question answered with text. */
export function fitsQuestion(question: SurveyQuestion, answer: string | null): boolean {
  if (answer === null) return true;
  const choices = questionChoices(question);
  return choices.length === 0 ? answer.trim().length > 0 : choices.includes(answer);
}
