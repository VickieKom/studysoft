import { describe, expect, it } from "vitest";
import { criteriaComplete, criteriaPercent, skillPercents } from "./assessment-review";

describe("the assessment's percents (#254)", () => {
  it("scores a section by the criteria as the sum of six", () => {
    expect(criteriaPercent([2, 1, 1])).toBe(67);
    expect(criteriaPercent([2, 2, 1])).toBe(83);
    expect(criteriaPercent([0, 0, 0])).toBe(0);
    expect(criteriaPercent([2, 2, 2])).toBe(100);
    expect(criteriaPercent([1, 0, 0])).toBe(17);
  });

  it("gives each skill with a percent, in the format's order: auto-checked right of all, the teacher's by the criteria", () => {
    const skills = ["listening", "reading", "grammar", "vocabulary", "writing", "speaking"] as const;
    expect(
      skillPercents(skills, { listening: { right: 1, total: 2 }, reading: { right: 1, total: 1 }, vocabulary: { right: 0, total: 2 } }, { speaking: [2, 2, 1], writing: [2, 1, 1] }),
    ).toEqual([
      { skill: "listening", percent: 50 },
      { skill: "reading", percent: 100 },
      { skill: "vocabulary", percent: 0 },
      { skill: "writing", percent: 67 },
      { skill: "speaking", percent: 83 },
    ]);
  });

  it("leaves out a section not started, one not scored yet, and one the assessment does not have", () => {
    expect(skillPercents(["grammar", "writing"], {}, {})).toEqual([]);
    expect(skillPercents(["reading"], { reading: { right: 0, total: 0 }, grammar: { right: 1, total: 1 } }, { writing: [2, 2, 2] })).toEqual([]);
  });

  it("is complete once every section the teacher scores is scored", () => {
    expect(criteriaComplete(["reading", "writing", "speaking"], { writing: [1, 1, 1] })).toBe(false);
    expect(criteriaComplete(["reading", "writing", "speaking"], { writing: [1, 1, 1], speaking: [0, 0, 0] })).toBe(true);
    expect(criteriaComplete(["reading", "speaking"], { speaking: [0, 1, 2] })).toBe(true);
    expect(criteriaComplete(["reading"], {})).toBe(true);
  });
});
