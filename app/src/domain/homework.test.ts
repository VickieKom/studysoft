import { describe, expect, it } from "vitest";
import { answerKey, formatDueDate, tasksLabel } from "./homework";
import type { Task } from "./homework-format";

describe("homework labels", () => {
  it("pluralises the number of tasks", () => {
    expect([1, 2, 4, 5, 11, 12, 21, 22, 25].map(tasksLabel)).toEqual([
      "1 задание",
      "2 задания",
      "4 задания",
      "5 заданий",
      "11 заданий",
      "12 заданий",
      "21 задание",
      "22 задания",
      "25 заданий",
    ]);
  });

  it("shows a deadline as weekday, day and month after «к», whatever the time zone", () => {
    expect(formatDueDate("2026-11-14")).toBe("субботе, 14 ноября");
    expect(formatDueDate("2026-11-18")).toBe("среде, 18 ноября");
    expect(formatDueDate("2027-01-01")).toBe("пятнице, 1 января");
  });

  it("writes the key of every auto-checked task and none for the teacher-checked ones", () => {
    const keys = (
      [
        { type: "single_choice", prompt: "p", options: ["a", "b"], answer: 1 },
        { type: "multiple_choice", prompt: "p", options: ["a", "b", "c"], answers: [0, 2] },
        { type: "gap", prompt: "p", text: "___ and ___", answers: [["is", "'s"], ["am"]] },
        { type: "match", prompt: "p", pairs: [{ left: "hot", right: "cold" }, { left: "up", right: "down" }] },
        { type: "order", prompt: "p", words: ["a", "b"], alternatives: [["b", "a"]] },
        { type: "written", prompt: "p" },
        { type: "voice", prompt: "p" },
        { type: "file", prompt: "p" },
      ] satisfies Task[]
    ).map(answerKey);
    expect(keys).toEqual(["b", "a, c", "is / 's; am", "hot — cold; up — down", "a b / b a", null, null, null]);
  });
});
