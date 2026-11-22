import { describe, expect, it } from "vitest";
import { numberLines, type ReportNumbers, reportText, skillsInPeriod } from "./report";

const empty: ReportNumbers = { skills: [], measure: null, words: null, homework: null, textbook: null, lessons: null };

describe("a parent's report (#267)", () => {
  it("takes each skill's latest result in the period against the latest before it, leaving out a skill without one", () => {
    const results = [
      { skill: "reading" as const, percent: 60, measuredOn: "2026-10-01" },
      { skill: "reading" as const, percent: 65, measuredOn: "2026-10-25" },
      { skill: "reading" as const, percent: 70, measuredOn: "2026-11-10" },
      { skill: "grammar" as const, percent: 40, measuredOn: "2026-10-01" },
      { skill: "listening" as const, percent: 50, measuredOn: "2026-11-01" },
    ];
    expect(skillsInPeriod(results, "2026-10-22", "2026-11-21")).toEqual([
      { skill: "reading", percent: 70, trend: 10 },
      { skill: "listening", percent: 50, trend: null },
    ]);
    // The period's ends are its own.
    expect(skillsInPeriod(results, "2026-11-10", "2026-11-10")).toEqual([{ skill: "reading", percent: 70, trend: 5 }]);
  });

  it("writes the numbers as lines, the ones without data left out", () => {
    expect(numberLines(empty)).toEqual([]);
    expect(
      numberLines({
        skills: [{ skill: "reading", percent: 70, trend: -5 }],
        measure: "на английском: 5 → 12 мин",
        lessons: { held: 6, missed: 1, cancelled: 0 },
        homework: { submitted: 3, due: 4 },
        words: { added: 5, learnt: 12, total: 40 },
        textbook: { title: "Учебник", unitsPassed: 2, units: 10 },
      }),
    ).toEqual([
      "Чтение 70% · просадка −5",
      "на английском: 5 → 12 мин",
      "Уроки: проведено 6, пропущено 1, отменено 0",
      "Домашки: сдано 3 из 4",
      "Слова: новых 5, закрепилось 12 из 40",
      "Учебник: юнитов 2 из 10",
    ]);
  });

  it("gives the text for a messenger: the numbers, the filled blocks, the balance when shown, and the link", () => {
    const text = reportText({
      firstName: "Тестовая",
      periodFrom: "2026-10-22",
      periodTo: "2026-11-21",
      numbers: { ...empty, skills: [{ skill: "reading", percent: 70, trend: 10 }] },
      blocks: [
        { title: "Что получается", text: " Читает вслух. " },
        { title: "План", text: "  " },
      ],
      balance: "Осталось 2 урока",
      link: "https://example.test/p#token",
    });
    expect(text).toBe(
      "Отчёт: Тестовая, 22 октября 2026 — 21 ноября 2026\n\nЧтение 70% · рост +10\nОплата: Осталось 2 урока\n\nЧто получается\nЧитает вслух.\n\nПодробнее: https://example.test/p#token",
    );
    expect(reportText({ firstName: "Т", periodFrom: "2026-11-01", periodTo: "2026-11-02", numbers: empty, blocks: [], balance: null, link: "L" })).toBe(
      "Отчёт: Т, 1 ноября 2026 — 2 ноября 2026\n\nПодробнее: L",
    );
  });
});
