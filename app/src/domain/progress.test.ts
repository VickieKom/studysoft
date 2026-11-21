import { describe, expect, it } from "vitest";
import { monthLabel, skillsByMonth, slips, trendLabel, unitsPassed } from "./progress";

describe("«Прогресс» (#255)", () => {
  it("puts each assessed skill by month, the latest result of a month as its point, with the trend against the point before", () => {
    const { months, rows } = skillsByMonth([
      { skill: "reading", percent: 70, measuredOn: "2026-11-15" },
      { skill: "reading", percent: 50, measuredOn: "2026-10-01" },
      { skill: "reading", percent: 55, measuredOn: "2026-10-20" },
      { skill: "listening", percent: 60, measuredOn: "2026-10-20" },
      { skill: "grammar", percent: 80, measuredOn: "2026-11-15" },
    ]);
    expect(months).toEqual(["2026-10", "2026-11"]);
    expect(rows).toEqual([
      { skill: "reading", byMonth: { "2026-10": 55, "2026-11": 70 }, trend: 15 },
      // A skill missing in the last month: its trend is between the points it has.
      { skill: "listening", byMonth: { "2026-10": 60 }, trend: null },
      { skill: "grammar", byMonth: { "2026-11": 80 }, trend: null },
    ]);
  });

  it("names months and trends in Russian", () => {
    expect(monthLabel("2026-10")).toBe("октябрь 2026");
    expect(monthLabel("2027-01")).toBe("январь 2027");
    expect([20, -5, 0].map(trendLabel)).toEqual(["рост +20", "просадка −5", "без изменений"]);
  });

  it("counts the units passed up to the passed lesson", () => {
    const lesson = (id: string) => ({ id, title: id, pages: {}, tracks: [], words: [] });
    const structure = {
      units: [
        { title: "U1", lessons: [lesson("a"), lesson("b")] },
        { title: "U2", lessons: [lesson("c"), lesson("d")] },
      ],
    };
    expect(unitsPassed(structure, null)).toEqual({ passed: 0, total: 2 });
    expect(unitsPassed(structure, "a")).toEqual({ passed: 0, total: 2 });
    expect(unitsPassed(structure, "b")).toEqual({ passed: 1, total: 2 });
    expect(unitsPassed(structure, "d")).toEqual({ passed: 2, total: 2 });
    expect(unitsPassed(null, "x")).toEqual({ passed: 0, total: 0 });
  });

  it("counts a fall of 10 points or more as a slip, a smaller one or growth not (#257)", () => {
    const { rows } = skillsByMonth([
      { skill: "reading", percent: 70, measuredOn: "2026-10-15" },
      { skill: "reading", percent: 50, measuredOn: "2026-11-15" },
      { skill: "grammar", percent: 60, measuredOn: "2026-10-15" },
      { skill: "grammar", percent: 51, measuredOn: "2026-11-15" },
      { skill: "listening", percent: 60, measuredOn: "2026-10-15" },
      { skill: "listening", percent: 50, measuredOn: "2026-11-15" },
      { skill: "writing", percent: 40, measuredOn: "2026-10-15" },
      { skill: "writing", percent: 80, measuredOn: "2026-11-15" },
      { skill: "speaking", percent: 30, measuredOn: "2026-11-15" },
    ]);
    expect(slips(rows)).toEqual([
      { skill: "reading", trend: -20 },
      { skill: "listening", trend: -10 },
    ]);
  });
});
