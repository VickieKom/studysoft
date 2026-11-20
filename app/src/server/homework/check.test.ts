import { describe, expect, it } from "vitest";
import type { OrderTask, Task } from "../../domain/homework-format";
import { checkAnswer, checkSentences, fitsTask, normalize } from "./check";

const single: Task = { type: "single_choice", prompt: "p", options: ["a", "b", "c"], answer: 1 };
const multiple: Task = { type: "multiple_choice", prompt: "p", options: ["a", "b", "c", "d"], answers: [0, 2] };
const gap: Task = { type: "gap", prompt: "p", text: "___ raining. I ___ home.", answers: [["it's", "it is"], ["am"]] };
const match: Task = {
  type: "match",
  prompt: "p",
  pairs: [
    { left: "hot", right: "cold" },
    { left: "big", right: "small" },
  ],
};
const order: Task = {
  type: "order",
  prompt: "p",
  words: ["We", "play", "after", "school"],
  alternatives: [["After", "school", "we", "play"]],
};

describe("normalize", () => {
  it("ignores case, extra spaces and the kind of apostrophe", () => {
    expect(normalize("  IT’S   raining ")).toBe("it's raining");
    expect(normalize("itʼs")).toBe("it's");
    expect(normalize("it`s")).toBe("it's");
  });
});

describe("checkAnswer", () => {
  it("checks a single choice", () => {
    expect(checkAnswer(single, { type: "single_choice", choice: 1 })).toBe(true);
    expect(checkAnswer(single, { type: "single_choice", choice: 0 })).toBe(false);
  });

  it("wants every correct option and nothing else in a multiple choice", () => {
    expect(checkAnswer(multiple, { type: "multiple_choice", choices: [2, 0] })).toBe(true);
    expect(checkAnswer(multiple, { type: "multiple_choice", choices: [0] })).toBe(false);
    expect(checkAnswer(multiple, { type: "multiple_choice", choices: [0, 1, 2] })).toBe(false);
  });

  it("accepts any listed variant of a gap, normalised", () => {
    expect(checkAnswer(gap, { type: "gap", gaps: ["  IT’S ", "AM"] })).toBe(true);
    expect(checkAnswer(gap, { type: "gap", gaps: ["it is", "am"] })).toBe(true);
    expect(checkAnswer(gap, { type: "gap", gaps: ["it's", "is"] })).toBe(false);
    expect(checkAnswer(gap, { type: "gap", gaps: ["it's"] })).toBe(false);
  });

  it("wants every pair of a match", () => {
    const right = [
      { left: "big", right: "small" },
      { left: "hot", right: "cold" },
    ];
    expect(checkAnswer(match, { type: "match", pairs: right })).toBe(true);
    expect(checkAnswer(match, { type: "match", pairs: right.slice(0, 1) })).toBe(false);
    expect(
      checkAnswer(match, {
        type: "match",
        pairs: [
          { left: "hot", right: "small" },
          { left: "big", right: "cold" },
        ],
      }),
    ).toBe(false);
  });

  it("accepts the order or any alternative, ignoring case", () => {
    expect(checkAnswer(order, { type: "order", words: ["We", "play", "after", "school"] })).toBe(true);
    expect(checkAnswer(order, { type: "order", words: ["After", "school", "we", "play"] })).toBe(true);
    expect(checkAnswer(order, { type: "order", words: ["We", "after", "play", "school"] })).toBe(false);
  });

  it("counts an answer of another type as wrong", () => {
    expect(checkAnswer(single, { type: "gap", gaps: ["b"] })).toBe(false);
  });
});

describe("fitsTask", () => {
  it("refuses answers that cannot belong to the task", () => {
    expect(fitsTask(single, { type: "single_choice", choice: 3 })).toBe(false);
    expect(fitsTask(multiple, { type: "multiple_choice", choices: [0, 0] })).toBe(false);
    expect(fitsTask(gap, { type: "gap", gaps: ["x"] })).toBe(false);
    expect(fitsTask(match, { type: "match", pairs: [{ left: "hot", right: "warm" }] })).toBe(false);
    expect(
      fitsTask(match, {
        type: "match",
        pairs: [
          { left: "hot", right: "cold" },
          { left: "hot", right: "small" },
        ],
      }),
    ).toBe(false);
    expect(fitsTask(order, { type: "order", words: ["We", "We"] })).toBe(false);
    expect(fitsTask(order, { type: "single_choice", choice: 0 })).toBe(false);
  });

  it("takes partial answers, which the student may still finish", () => {
    expect(fitsTask(gap, { type: "gap", gaps: ["it's", ""] })).toBe(true);
    expect(fitsTask(match, { type: "match", pairs: [{ left: "hot", right: "small" }] })).toBe(true);
    expect(fitsTask(order, { type: "order", words: ["play", "We"] })).toBe(true);
  });
});

describe("an order task of several sentences (#161)", () => {
  const sentences: Task = {
    type: "order",
    prompt: "p",
    sentences: [
      { words: ["I", "like", "tea"] },
      { words: ["We", "go", "home"], alternatives: [["Home", "we", "go"]] },
    ],
  };

  it("checks each sentence on its own, alternatives included", () => {
    expect(checkSentences(sentences as OrderTask, { type: "order", sentences: [["i", "like", "tea"], ["Home", "we", "go"]] })).toEqual([
      true,
      true,
    ]);
    expect(checkSentences(sentences as OrderTask, { type: "order", sentences: [["tea", "like", "I"], ["We", "go", "home"]] })).toEqual([
      false,
      true,
    ]);
    // A sentence left out, an answer of the other shape and no answer: wrong.
    expect(checkSentences(sentences as OrderTask, { type: "order", sentences: [["I", "like", "tea"]] })).toEqual([true, false]);
    expect(checkSentences(sentences as OrderTask, { type: "order", words: ["I", "like", "tea"] })).toEqual([false, false]);
    expect(checkSentences(sentences as OrderTask, null)).toEqual([false, false]);
    expect(checkAnswer(sentences, { type: "order", sentences: [["I", "like", "tea"], ["We", "go", "home"]] })).toBe(true);
    expect(checkAnswer(sentences, { type: "order", sentences: [["I", "like", "tea"], ["We", "home", "go"]] })).toBe(false);
  });

  it("a task of one sentence is one point", () => {
    expect(checkSentences(order as OrderTask, { type: "order", words: ["We", "play", "after", "school"] })).toEqual([true]);
    expect(checkSentences(order as OrderTask, { type: "order", sentences: [["We", "play", "after", "school"]] })).toEqual([false]);
  });

  it("fits only words taken from each sentence's own words, one list per sentence", () => {
    expect(fitsTask(sentences, { type: "order", sentences: [["tea"], []] })).toBe(true);
    expect(fitsTask(sentences, { type: "order", sentences: [["home"], []] })).toBe(false);
    expect(fitsTask(sentences, { type: "order", sentences: [["tea", "tea"], []] })).toBe(false);
    expect(fitsTask(sentences, { type: "order", sentences: [["tea"]] })).toBe(false);
    expect(fitsTask(sentences, { type: "order", words: ["tea"] })).toBe(false);
    expect(fitsTask(order, { type: "order", sentences: [["We"]] })).toBe(false);
  });
});

describe("a match with pictures on the left (#184)", () => {
  const PNG = "blob:00000000-0000-4000-8000-000000000001";
  const pictures: Task = {
    type: "match",
    prompt: "p",
    pairs: [
      { left: { images: [PNG] }, right: "one" },
      { left: { images: [PNG], text: "Tom" }, right: "two" },
    ],
  };

  it("names a picture by its caption or its number, and checks the pairs by those names", () => {
    const right = [
      { left: "картинка 1", right: "one" },
      { left: "Tom", right: "two" },
    ];
    expect(checkAnswer(pictures, { type: "match", pairs: right })).toBe(true);
    expect(checkAnswer(pictures, { type: "match", pairs: [{ left: "картинка 1", right: "two" }, { left: "Tom", right: "one" }] })).toBe(false);
    expect(fitsTask(pictures, { type: "match", pairs: right })).toBe(true);
    expect(fitsTask(pictures, { type: "match", pairs: [{ left: "картинка 2", right: "one" }] })).toBe(false);
  });
});
