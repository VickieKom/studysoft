import { describe, expect, it } from "vitest";
import { formatDueDate, tasksLabel } from "./homework";

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

  it("shows a deadline as day and month, whatever the time zone", () => {
    expect(formatDueDate("2026-11-14")).toBe("14 ноября");
    expect(formatDueDate("2027-01-01")).toBe("1 января");
  });
});
