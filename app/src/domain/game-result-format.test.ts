import { describe, expect, it } from "vitest";
import { gameResultSchema, looksLikeGameResult } from "./game-result-format";

const answer = { task: "Which one is an animal?", answer: "a table", correct: false, topic: "animals", skill: "vocabulary" };

describe("the game result format", () => {
  it("accepts a result with optional topic and skill, and a blank answer", () => {
    const parsed = gameResultSchema.parse({
      type: "studysoft.game-result",
      version: 1,
      answers: [answer, { task: "Say hello", answer: "  ", correct: false }],
    });
    expect(parsed.answers[1]).toEqual({ task: "Say hello", answer: "", correct: false });
  });

  it("refuses a result with a field it does not know, a blank task or a topic too long", () => {
    for (const answers of [[{ ...answer, points: 3 }], [{ ...answer, task: "  " }], [{ ...answer, topic: "t".repeat(101) }]]) {
      expect(gameResultSchema.safeParse({ type: "studysoft.game-result", version: 1, answers }).success).toBe(false);
    }
  });

  it("tells a result from any other message a game posts", () => {
    expect(looksLikeGameResult({ type: "studysoft.game-result" })).toBe(true);
    for (const other of [null, "studysoft.game-result", { type: "resize" }, [], 1]) expect(looksLikeGameResult(other)).toBe(false);
  });
});

describe("version 2 of the game result format (#285)", () => {
  const answer = { task: "What is «чайник»?", answer: "cup", correct: false };
  it("takes an answer's word, and version 1 still has none", () => {
    expect(gameResultSchema.safeParse({ type: "studysoft.game-result", version: 2, answers: [{ ...answer, word: "teapot" }] }).success).toBe(true);
    expect(gameResultSchema.safeParse({ type: "studysoft.game-result", version: 2, answers: [answer] }).success).toBe(true);
    expect(gameResultSchema.safeParse({ type: "studysoft.game-result", version: 1, answers: [answer] }).success).toBe(true);
    expect(gameResultSchema.safeParse({ type: "studysoft.game-result", version: 1, answers: [{ ...answer, word: "teapot" }] }).success).toBe(false);
    expect(gameResultSchema.safeParse({ type: "studysoft.game-result", version: 3, answers: [answer] }).success).toBe(false);
    expect(gameResultSchema.safeParse({ type: "studysoft.game-result", version: 2, answers: [{ ...answer, word: "x".repeat(201) }] }).success).toBe(false);
  });
});
