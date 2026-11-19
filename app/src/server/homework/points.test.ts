import { describe, expect, it } from "vitest";
import { countPoints, pointVerdicts, sentenceVerdicts, taskVerdict } from "./points";

// The score counted from stored answers (#161): a task is one point, each
// sentence of an order task of several is one; the teacher's mark wins.

describe("points", () => {
  const sentences = [
    { correct: true, mark: null },
    { correct: false, mark: null },
    { correct: false, mark: true },
  ];

  it("counts each sentence of an order task as a point, the teacher's mark winning", () => {
    expect(pointVerdicts({ correct: false, mark: null, sentences })).toEqual([true, false, true]);
    expect(
      countPoints([
        { correct: false, mark: null, sentences },
        { correct: true, mark: null, sentences: null },
        { correct: null, mark: null, sentences: null },
        { correct: true, mark: false, sentences: null },
      ]),
    ).toEqual({ correct: 3, wrong: 2, pending: 1 });
  });

  it("a task as a whole is wrong when any point is, waiting when any waits", () => {
    expect(taskVerdict([true, false, null])).toBe(false);
    expect(taskVerdict([true, null])).toBeNull();
    expect(taskVerdict([true, true])).toBe(true);
  });

  it("reads only well-formed sentence results; anything else is a task of one point", () => {
    expect(sentenceVerdicts(null)).toBeNull();
    expect(sentenceVerdicts([{ correct: "yes" }])).toBeNull();
    expect(pointVerdicts({ correct: true, mark: null, sentences: [{ correct: "yes" }] })).toEqual([true]);
  });
});
