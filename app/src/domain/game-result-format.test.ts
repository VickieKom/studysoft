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
