import { describe, expect, it } from "vitest";
import { HOMEWORK_STAGE_MINUTES, type LessonPlan, MAX_STAGES, withWaitingHomework } from "./lesson-plan";

const HOMEWORK = "00000000-0000-4000-8000-000000000011";
const OTHER_HOMEWORK = "00000000-0000-4000-8000-000000000012";
const LESSON = "00000000-0000-4000-8000-000000000013";

const submittedAt = new Date("2026-11-18T15:00:00Z");
const waiting = { id: HOMEWORK, title: "Demo", submittedAt };
const plan: LessonPlan = { stages: [{ type: "book", lessonId: LESSON, skip: "", minutes: 30 }] };
const review = { type: "homework" as const, homeworkId: HOMEWORK, minutes: HOMEWORK_STAGE_MINUTES };

describe("withWaitingHomework", () => {
  it("leaves the plan alone when no homework waits", () => {
    expect(withWaitingHomework(plan, null, null)).toBe(plan);
  });

  it("puts the review first in a plan the teacher has not saved", () => {
    expect(withWaitingHomework(plan, waiting, null).stages).toEqual([review, plan.stages[0]]);
  });

  it("puts it first in a plan saved before the homework was submitted", () => {
    expect(withWaitingHomework(plan, waiting, new Date("2026-11-18T14:59:59Z")).stages[0]).toEqual(review);
  });

  it("leaves out a review the teacher removed: she saved the plan after the submission", () => {
    expect(withWaitingHomework(plan, waiting, submittedAt)).toBe(plan);
    expect(withWaitingHomework(plan, waiting, new Date("2026-11-18T16:00:00Z"))).toBe(plan);
  });

  it("never adds the same homework twice, wherever the teacher put it", () => {
    const moved: LessonPlan = { stages: [plan.stages[0]!, review] };
    expect(withWaitingHomework(moved, waiting, null)).toBe(moved);
  });

  it("adds the waiting homework beside the review of an earlier one", () => {
    const earlier: LessonPlan = { stages: [{ type: "homework", homeworkId: OTHER_HOMEWORK, minutes: 5 }] };
    expect(withWaitingHomework(earlier, waiting, null).stages.map((s) => s.type === "homework" && s.homeworkId)).toEqual([HOMEWORK, OTHER_HOMEWORK]);
  });

  it("keeps a full plan within the limit", () => {
    const full: LessonPlan = { stages: Array.from({ length: MAX_STAGES }, () => plan.stages[0]!) };
    const result = withWaitingHomework(full, waiting, null);
    expect(result.stages).toHaveLength(MAX_STAGES);
    expect(result.stages[0]).toEqual(review);
  });
});
