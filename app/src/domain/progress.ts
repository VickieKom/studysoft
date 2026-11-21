// «Прогресс» on the student card (#255): the results by skill as a table by
// month, growth or slip against the point before, and how far the textbook
// is covered. Plain data and functions only.
import { z } from "zod";
import { SKILLS } from "./homework-format";
import type { TextbookStructure } from "./textbook-structure";

export type Skill = (typeof SKILLS)[number];

/** The skills in the order the dashboard shows them. */
export const PROGRESS_SKILLS = ["reading", "listening", "grammar", "vocabulary", "writing", "speaking"] as const satisfies readonly Skill[];
export const SKILL_LABELS: Record<Skill, string> = {
  reading: "Чтение",
  listening: "Аудирование",
  grammar: "Грамматика",
  vocabulary: "Лексика",
  writing: "Письмо",
  speaking: "Говорение",
};

export type SkillResult = { skill: Skill; percent: number; measuredOn: string };
export type SkillRow = { skill: Skill; byMonth: Record<string, number>; trend: number | null };

/**
 * The months that have a result, oldest first, and a row per skill that has
 * one: the latest result of a month is its point (results of one date and
 * skill are unique), and the trend is the last point against the one before.
 */
export function skillsByMonth(results: SkillResult[]): { months: string[]; rows: SkillRow[] } {
  const sorted = [...results].sort((a, b) => a.measuredOn.localeCompare(b.measuredOn));
  const months = [...new Set(sorted.map((r) => r.measuredOn.slice(0, 7)))];
  const rows: SkillRow[] = [];
  for (const skill of PROGRESS_SKILLS) {
    const byMonth: Record<string, number> = {};
    for (const r of sorted) if (r.skill === skill) byMonth[r.measuredOn.slice(0, 7)] = r.percent;
    const points = months.filter((m) => m in byMonth).map((m) => byMonth[m]!);
    if (points.length === 0) continue;
    rows.push({ skill, byMonth, trend: points.length > 1 ? points.at(-1)! - points.at(-2)! : null });
  }
  return { months, rows };
}

const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

/** "2026-10" → «октябрь 2026». */
export function monthLabel(month: string): string {
  const [year, m] = month.split("-");
  return `${MONTHS[Number(m) - 1]} ${year}`;
}

/** «рост +20», «просадка −5», «без изменений». */
export function trendLabel(trend: number): string {
  if (trend > 0) return `рост +${trend}`;
  if (trend < 0) return `просадка −${-trend}`;
  return "без изменений";
}

/** Units passed: those whose every lesson is at or before the passed lesson, in the structure's order. */
export function unitsPassed(structure: TextbookStructure | null, passedLessonId: string | null): { passed: number; total: number } {
  const units = structure?.units ?? [];
  if (!passedLessonId) return { passed: 0, total: units.length };
  const order = units.flatMap((u) => u.lessons.map((l) => l.id));
  const at = order.indexOf(passedLessonId);
  if (at < 0) return { passed: 0, total: units.length };
  let seen = 0;
  let passed = 0;
  for (const unit of units) {
    seen += unit.lessons.length;
    if (seen - 1 <= at) passed++;
  }
  return { passed, total: units.length };
}

const MONTHS_OF = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

/** "2026-11-15" → «15 ноября 2026». */
export function dateLabel(date: string): string {
  const [year, month, day] = date.split("-");
  return `${Number(day)} ${MONTHS_OF[Number(month) - 1]} ${year}`;
}

/** What a dashboard gets (#255, #256): the results by skill and the totals beside them; no answers, recordings or notes. */
export const progressViewSchema = z
  .object({
    results: z.array(z.object({ skill: z.enum(PROGRESS_SKILLS), percent: z.number().int().min(0).max(100), measuredOn: z.iso.date() }).strict()),
    homework: z.object({ submitted: z.number().int(), due: z.number().int() }).strict(),
    textbook: z.object({ title: z.string(), unitsPassed: z.number().int(), units: z.number().int() }).strict().nullable(),
    words: z.object({ total: z.number().int(), learnt: z.number().int() }).strict(),
  })
  .strict();
export type ProgressView = z.infer<typeof progressViewSchema>;

/** A slip worth the teacher's attention: a fall of this many points or more from the point before (product owner, 2026-11-20). */
export const SLIP_POINTS = 10;

/** The skills whose last point fell by `SLIP_POINTS` or more, in the dashboard's order. */
export function slips(rows: readonly SkillRow[]): { skill: Skill; trend: number }[] {
  return rows.flatMap((r) => (r.trend !== null && r.trend <= -SLIP_POINTS ? [{ skill: r.skill, trend: r.trend }] : []));
}
