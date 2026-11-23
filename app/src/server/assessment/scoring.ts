// Scoring the auto-checked sections of the monthly assessment (#253), on
// the server only: a typed word is compared as homework compares it.
import {
  AUTO_SECTIONS,
  type AssessmentAnswers,
  type AutoScores,
  type AutoSkill,
  started,
} from "../../domain/assessment-answers";
import type { AssessmentDocument } from "../../domain/assessment-format";
import { normalize } from "../homework/check";

/** Whether each question of an auto-checked section was answered right, by position. */
function rightAnswers(document: AssessmentDocument, skill: AutoSkill, answers: AssessmentAnswers): boolean[] {
  const section = document.sections.find((s) => s.skill === skill);
  const given = answers[skill] ?? [];
  if (!section) return [];
  switch (section.skill) {
    case "listening":
      return section.questions.map((q, i) => given[i] === String(q.answer));
    case "reading":
      return section.questions.map((q, i) => given[i] === String(q.answer));
    case "grammar":
      return section.gaps.map((g, i) => given[i] === String(g.answer));
    case "vocabulary":
      return section.questions.map((q, i) => {
        const answer = given[i];
        return answer !== null && answer !== undefined && q.answers.some((variant) => normalize(variant) === normalize(answer));
      });
    default:
      return [];
  }
}

/**
 * The scores of the auto-checked sections, for «Сдать» and «Завершить
 * замер»: each section the child started, right of all its questions with
 * an unanswered one wrong; a section not started has none.
 */
export function autoScores(document: AssessmentDocument, answers: AssessmentAnswers): AutoScores {
  const scores: AutoScores = {};
  for (const skill of AUTO_SECTIONS) {
    if (!document.sections.some((s) => s.skill === skill) || !started(answers, skill)) continue;
    const right = rightAnswers(document, skill, answers);
    scores[skill] = { right: right.filter(Boolean).length, total: right.length };
  }
  return scores;
}

/**
 * The vocabulary words of «Лексика» questions scored wrong, unanswered ones
 * included, when the section was started: they come back into the word
 * training (#253, as homework does in #284).
 */
export function missedWords(document: AssessmentDocument, answers: AssessmentAnswers): string[] {
  const section = document.sections.find((s) => s.skill === "vocabulary");
  if (!section || section.skill !== "vocabulary" || !started(answers, "vocabulary")) return [];
  const right = rightAnswers(document, "vocabulary", answers);
  return section.questions.flatMap((q, i) => (!right[i] && q.vocabularyWord ? [q.vocabularyWord] : []));
}
