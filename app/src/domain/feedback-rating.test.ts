import { describe, expect, it } from "vitest";
import { likedMost, newestAnswer, rateMaterialKinds, rateMehKinds, rateTaskKinds, rateTopics, ratedLine, splitFeedback } from "./feedback-rating";

// «Что заходит» (#333): two ratings and the topics, «3 из 3» chosen in three answers of three.

describe("the homework's kinds of tasks", () => {
  it("counts each answer once for its kind, «Все классные» for every kind of its homework", () => {
    const rated = rateTaskKinds([
      { answer: "single_choice", kinds: ["single_choice", "written"] },
      { answer: "single_choice", kinds: ["single_choice", "gap"] },
      { answer: "all", kinds: ["gap", "written", "gap"] },
    ]);
    expect(rated).toEqual([
      { key: "single_choice", chosen: 2, of: 3 },
      { key: "gap", chosen: 1, of: 3 },
      { key: "written", chosen: 1, of: 3 },
    ]);
    expect(ratedLine("Выбрать ответ", rated[0]!)).toBe("Выбрать ответ — 2 из 3");
  });
});

describe("the lesson materials' kinds", () => {
  it("counts the pick of each pair, «Оба классные» once per kind, «Оба так себе» nothing", () => {
    expect(
      rateMaterialKinds([
        { a: "game", b: "video", picked: "a" },
        { a: "game", b: "video", picked: "a" },
        { a: "game", b: "game", picked: "both" },
        { a: "warmup", b: "video", picked: "neither" },
      ]),
    ).toEqual([{ key: "game", chosen: 3, of: 4 }]);
    expect(rateMaterialKinds([{ a: "warmup", b: "video", picked: "both" }])).toEqual([
      { key: "video", chosen: 1, of: 1 },
      { key: "warmup", chosen: 1, of: 1 },
    ]);
    expect(rateMaterialKinds([{ a: null, b: "video", picked: "a" }])).toEqual([]);
  });
});

describe("what the child likes most", () => {
  it("is the top kind of material, else of task, in lower case; nothing before any answer", () => {
    expect(likedMost([{ key: "game", chosen: 3, of: 3 }], [{ key: "single_choice", chosen: 2, of: 2 }])).toBe("игры");
    expect(likedMost([], [{ key: "single_choice", chosen: 2, of: 2 }])).toBe("выбрать ответ");
    expect(likedMost([], [])).toBeNull();
  });

  it("lists the topics, the most chosen first", () => {
    expect(rateTopics(["planets", "pets", "planets"])).toEqual([
      { topic: "planets", chosen: 2 },
      { topic: "pets", chosen: 1 },
    ]);
  });
});

describe("what «Фидбэк» shows", () => {
  const now = Date.parse("2026-11-24T12:00:00.000Z");
  const day = (n: number) => ({ answeredAt: new Date(now - n * 86_400_000).toISOString() });

  it("shows the week's answers and the unseen older ones; the seen older ones go under «Все ответы»", () => {
    const answers = [day(1), day(9), day(20)];
    // Seen up to 15 days ago: the 9-day answer is new, the 20-day one seen.
    expect(splitFeedback(answers, day(15).answeredAt, now)).toEqual({ shown: [day(1), day(9)], older: [day(20)] });
    // Seen up to yesterday: the week shows, the rest is older.
    expect(splitFeedback(answers, day(1).answeredAt, now)).toEqual({ shown: [day(1)], older: [day(9), day(20)] });
    expect(splitFeedback(answers, null, now).older).toEqual([]);
  });

  it("is seen up to the newest answer it shows", () => {
    expect(newestAnswer([day(9), day(1), day(3)])).toBe(day(1).answeredAt);
    expect(newestAnswer([])).toBeNull();
  });
});

describe("the kinds of «Оба так себе», for the assistant", () => {
  it("counts each kind of a pair answered so, of the pairs it was in, a kind never so left out", () => {
    expect(
      rateMehKinds([
        { a: "game", b: "video", picked: "neither" },
        { a: "game", b: "warmup", picked: "a" },
        { a: "video", b: "video", picked: "neither" },
      ]),
    ).toEqual([
      { key: "video", meh: 2, of: 2 },
      { key: "game", meh: 1, of: 2 },
    ]);
  });
});
