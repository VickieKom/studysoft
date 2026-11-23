import { describe, expect, it } from "vitest";
import { validAnswer, withAnswer } from "../../domain/assessment-answers";
import { type AssessmentDocument, validateAssessment } from "../../domain/assessment-format";
import { autoScores, missedWords } from "./scoring";

const WORD = "00000000-0000-4000-8000-00000000000a";
const READING = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}: the demo robot walks to the blue box and back.`).join(" ");

function demo(): AssessmentDocument {
  const checked = validateAssessment({
    version: 1,
    title: "Scoring demo",
    sections: [
      { skill: "listening", questions: [{ question: "Where?", options: ["a", "b", "c"], answer: 1 }] },
      {
        skill: "reading",
        text: READING,
        questions: [
          { type: "true_false", statement: "Blue.", answer: "not_given" },
          { type: "choice", question: "Who?", options: ["x", "y", "z"], answer: 2 },
        ],
      },
      { skill: "grammar", text: "He ___ home.", gaps: [{ options: ["go", "went"], answer: 1 }] },
      {
        skill: "vocabulary",
        questions: [
          { type: "translation", translation: "камешек", answers: ["pebble", "stone"], vocabularyWord: WORD },
          { type: "sentence", text: "A ___ of stones.", answers: ["crate"] },
        ],
      },
      { skill: "writing", task: "Write a note." },
      { skill: "speaking", questions: ["What can you see?"] },
    ],
  });
  if (!checked.ok) throw new Error(checked.errors.join("\n"));
  return checked.assessment;
}

describe("scoring an assessment", () => {
  it("scores each started auto-checked section, an unanswered question wrong, and leaves the rest out", () => {
    const answers = { reading: ["not_given", null], vocabulary: ["  Stone ", "box"], writing: ["A note."] };
    expect(autoScores(demo(), answers)).toEqual({ reading: { right: 1, total: 2 }, vocabulary: { right: 1, total: 2 } });
  });

  it("counts a choice by its option's number and a word in any case and spacing", () => {
    expect(autoScores(demo(), { listening: ["1"], grammar: ["0"], vocabulary: ["PEBBLE", " crate"] })).toEqual({
      listening: { right: 1, total: 1 },
      grammar: { right: 0, total: 1 },
      vocabulary: { right: 2, total: 2 },
    });
  });

  it("does not count a section with only blank answers as started", () => {
    expect(autoScores(demo(), { vocabulary: ["  ", null] })).toEqual({});
    expect(missedWords(demo(), { vocabulary: ["  ", null] })).toEqual([]);
  });

  it("brings back the vocabulary word of a «Лексика» question scored wrong, unanswered included, once started", () => {
    expect(missedWords(demo(), { vocabulary: ["rock", "crate"] })).toEqual([WORD]);
    expect(missedWords(demo(), { vocabulary: [null, "crate"] })).toEqual([WORD]);
    expect(missedWords(demo(), { vocabulary: ["pebble", null] })).toEqual([]);
  });
});

describe("an answer of the child", () => {
  it("must be an existing option, true / false / not given, or text within its limit", () => {
    const document = demo();
    expect(validAnswer(document, "listening", 0, "2")).toBe(true);
    expect(validAnswer(document, "listening", 0, "3")).toBe(false);
    expect(validAnswer(document, "listening", 0, "-1")).toBe(false);
    expect(validAnswer(document, "listening", 1, "0")).toBe(false);
    expect(validAnswer(document, "reading", 0, "not_given")).toBe(true);
    expect(validAnswer(document, "reading", 0, "1")).toBe(false);
    expect(validAnswer(document, "reading", 1, "2")).toBe(true);
    expect(validAnswer(document, "vocabulary", 0, "x".repeat(201))).toBe(false);
    expect(validAnswer(document, "writing", 0, "Dear Pim")).toBe(true);
    expect(validAnswer(document, "writing", 1, "Dear Pim")).toBe(false);
    expect(validAnswer(document, "speaking", 0, "hello")).toBe(false);
    expect(validAnswer(document, "grammar", 0, null)).toBe(true);
  });

  it("fills the positions before it with nothing", () => {
    expect(withAnswer({ grammar: ["1"] }, "vocabulary", 2, "box")).toEqual({ grammar: ["1"], vocabulary: [null, null, "box"] });
  });
});
