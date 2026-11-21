import { describe, expect, it } from "vitest";
import { todayIn } from "./homework";
import { addDays, afterAnswer, exerciseFor, GAP_STEP, gapSentence, isDue, isMastered, MASTERED_STEP, wordMark } from "./word-training";

describe("the word training's schedule (#238)", () => {
  it("moves a right answer on through 1, 2, 4, 8 and 16 days, learnt after five on different days", () => {
    let state = { step: 0, dueOn: null as string | null };
    let today = "2026-11-20";
    const gaps: number[] = [];
    for (let i = 0; i < 5; i++) {
      expect(isDue(state.dueOn, today)).toBe(true);
      expect(isMastered(state.step)).toBe(false);
      const next = afterAnswer(state, true, today, true);
      gaps.push((Date.parse(next.dueOn!) - Date.parse(today)) / 86_400_000);
      // Not due again the same day.
      expect(isDue(next.dueOn, today)).toBe(false);
      state = next;
      today = next.dueOn!;
    }
    expect(gaps).toEqual([1, 2, 4, 8, 16]);
    expect(state.step).toBe(MASTERED_STEP);
    expect(isMastered(state.step)).toBe(true);
    // A learnt word keeps coming back every 16 days.
    expect(afterAnswer(state, true, today, true)).toEqual({ step: MASTERED_STEP, dueOn: addDays(today, 16) });
  });

  it("brings a wrong answer back tomorrow from the start, a learnt word too", () => {
    expect(afterAnswer({ step: 3, dueOn: "2026-11-20" }, false, "2026-11-20", true)).toEqual({ step: 0, dueOn: "2026-11-21" });
    expect(afterAnswer({ step: MASTERED_STEP, dueOn: "2026-11-20" }, false, "2026-11-20", true)).toEqual({ step: 0, dueOn: "2026-11-21" });
  });

  it("moves nothing for a right answer that does not count («Ещё разок»), but a wrong one still comes back tomorrow", () => {
    const state = { step: 2, dueOn: "2026-11-24" };
    expect(afterAnswer(state, true, "2026-11-20", false)).toEqual(state);
    expect(afterAnswer(state, false, "2026-11-20", false)).toEqual({ step: 0, dueOn: "2026-11-21" });
  });

  it("counts days across month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-11-30", 16)).toBe("2026-12-16");
  });

  it("takes «today» in the student's time zone", () => {
    // 22:30 in UTC on the 20th is already the 21st in Moscow and still the 20th in New York.
    const moment = new Date("2026-11-20T22:30:00Z");
    expect(todayIn("Europe/Moscow", moment)).toBe("2026-11-21");
    expect(todayIn("America/New_York", moment)).toBe("2026-11-20");
    expect(isDue("2026-11-21", todayIn("Europe/Moscow", moment))).toBe(true);
    expect(isDue("2026-11-21", todayIn("America/New_York", moment))).toBe(false);
  });

  it("starts a word with choosing its translation, then its word, then typing; typing when there is nothing to choose from", () => {
    expect([0, 1, 2, 4, 5].map((step) => exerciseFor(step, true))).toEqual(["choose_translation", "choose_word", "type_word", "type_word", "type_word"]);
    expect(exerciseFor(0, false)).toBe("type_word");
  });
});

describe("a word's mark for the teacher (#240)", () => {
  it("is nothing before a training, then learning, often wrong with more mistakes than right answers, learnt at the last step", () => {
    expect(wordMark({ step: 0, rightCount: 0, wrongCount: 0, trained: false })).toBeNull();
    expect(wordMark({ step: 0, rightCount: 0, wrongCount: 1, trained: true })).toBe("often_wrong");
    expect(wordMark({ step: 1, rightCount: 1, wrongCount: 1, trained: true })).toBe("learning");
    expect(wordMark({ step: 2, rightCount: 2, wrongCount: 0, trained: true })).toBe("learning");
    expect(wordMark({ step: MASTERED_STEP, rightCount: 5, wrongCount: 9, trained: true })).toBe("learnt");
  });
});

describe("«Вставь слово в предложение» (#239)", () => {
  it("makes the word a gap in its example: its first use as it is, case aside, never inside a longer word", () => {
    expect(gapSentence("The teapot is hot.", "teapot")).toBe("The ___ is hot.");
    expect(gapSentence("Teapot first, then the teapot again.", "teapot")).toBe("___ first, then the teapot again.");
    expect(gapSentence("Mind the ladder!", " Ladder ")).toBe("Mind the ___!");
    expect(gapSentence("She will look  after the cat.", "look after")).toBe("She will ___ the cat.");
    expect(gapSentence("Don't run (fast).", "(fast)")).toBe("Don't run ___.");
  });

  it("gives no gap when the example does not use the word as it is, or there is no example", () => {
    expect(gapSentence("She went home.", "go")).toBeNull();
    expect(gapSentence("The teapots are hot.", "teapot")).toBeNull();
    expect(gapSentence("A carpet.", "car")).toBeNull();
    expect(gapSentence(null, "teapot")).toBeNull();
    expect(gapSentence("", "teapot")).toBeNull();
  });

  it("comes at the third right answer in a row, and always in «Ещё разок»; never without a gap", () => {
    expect([0, 1, 2, 3, 5].map((step) => exerciseFor(step, true, true))).toEqual(["choose_translation", "choose_word", "fill_gap", "type_word", "type_word"]);
    expect(GAP_STEP).toBe(2);
    expect([0, 1, 3].map((step) => exerciseFor(step, true, true, true))).toEqual(["fill_gap", "fill_gap", "fill_gap"]);
    // Too few words to choose from: still a gap, typed.
    expect(exerciseFor(2, false, true)).toBe("fill_gap");
    expect([0, 1, 2, 3].map((step) => exerciseFor(step, true, false, true))).toEqual(["choose_translation", "choose_word", "type_word", "type_word"]);
    expect(exerciseFor(2, false, false)).toBe("type_word");
  });
});
