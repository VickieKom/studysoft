import { describe, expect, it } from "vitest";
import { criteriaComplete, criteriaPercent, criteriaUnsaved, skillPercents } from "./assessment-review";

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

describe("a section's unsaved scores (#400)", () => {
  it("has none while the picks are what the server has, or nothing is picked and nothing stored", () => {
    expect(criteriaUnsaved([2, 1, 1], [2, 1, 1])).toBe(false);
    expect(criteriaUnsaved([null, null, null], null)).toBe(false);
  });

  it("has some once a pick differs from what was loaded, or is made with nothing stored", () => {
    expect(criteriaUnsaved([2, 1, 0], [2, 1, 1])).toBe(true);
    expect(criteriaUnsaved([2, null, null], null)).toBe(true);
  });

  it("compares with the last save, not the load: saved then changed again is unsaved", () => {
    const loaded = [1, 1, 1];
    const saved = [2, 1, 1];
    expect(criteriaUnsaved([2, 1, 1], loaded)).toBe(true);
    expect(criteriaUnsaved([2, 1, 1], saved)).toBe(false);
    expect(criteriaUnsaved([2, 2, 1], saved)).toBe(true);
  });

  it("has none once the picks are put back to what is saved", () => {
    expect(criteriaUnsaved([1, 1, 1], [1, 1, 1])).toBe(false);
  });

  it("stays unsaved after a failed save, which leaves the stored scores as they were", () => {
    const stored = [1, 1, 1];
    expect(criteriaUnsaved([0, 1, 1], stored)).toBe(true);
  });
});
