// A parent's report (#267): the teacher's blocks of text and the numbers of
// the period the platform fills in, and the plain text for a messenger.
// Plain data and functions only.
import { z } from "zod";
import { dateLabel, PROGRESS_SKILLS, type Skill, SKILL_LABELS, type SkillResult, trendLabel } from "./progress";

/** The blocks a new report offers; the teacher removes any and adds her own (product owner, 2026-11-21). */
export const DEFAULT_BLOCKS = ["Что получается", "Над чем работаем", "План", "Чем помочь дома"] as const;
/** The first report covers this many days up to today. */
export const FIRST_PERIOD_DAYS = 30;
export const MAX_BLOCKS = 12;

export const reportBlockSchema = z.object({ title: z.string().trim().min(1).max(100), text: z.string().max(5000) }).strict();
export type ReportBlock = z.infer<typeof reportBlockSchema>;

export const reportNumbersSchema = z
  .object({
    skills: z.array(z.object({ skill: z.enum(PROGRESS_SKILLS), percent: z.number().int(), trend: z.number().int().nullable() }).strict()),
    measure: z.string().nullable(),
    words: z.object({ added: z.number().int(), learnt: z.number().int(), total: z.number().int() }).strict().nullable(),
    homework: z.object({ submitted: z.number().int(), due: z.number().int() }).strict().nullable(),
    textbook: z.object({ title: z.string(), unitsPassed: z.number().int(), units: z.number().int() }).strict().nullable(),
    lessons: z.object({ held: z.number().int(), missed: z.number().int(), cancelled: z.number().int() }).strict().nullable(),
  })
  .strict();
export type ReportNumbers = z.infer<typeof reportNumbersSchema>;

/**
 * Each skill's latest result in the period, with its growth or slip against
 * the latest before the period; a skill without a result in the period is
 * left out.
 */
export function skillsInPeriod(results: readonly SkillResult[], from: string, to: string): ReportNumbers["skills"] {
  const sorted = [...results].sort((a, b) => a.measuredOn.localeCompare(b.measuredOn));
  return PROGRESS_SKILLS.flatMap((skill: Skill) => {
    const own = sorted.filter((r) => r.skill === skill);
    const inPeriod = own.filter((r) => r.measuredOn >= from && r.measuredOn <= to).at(-1);
    if (!inPeriod) return [];
    const before = own.filter((r) => r.measuredOn < from).at(-1);
    return [{ skill, percent: inPeriod.percent, trend: before ? inPeriod.percent - before.percent : null }];
  });
}

/** The numbers as lines, the ones without data left out: «Чтение 70% · рост +10». */
export function numberLines(numbers: ReportNumbers): string[] {
  const lines = numbers.skills.map((s) => `${SKILL_LABELS[s.skill]} ${s.percent}%${s.trend === null ? "" : ` · ${trendLabel(s.trend)}`}`);
  if (numbers.measure) lines.push(numbers.measure);
  if (numbers.lessons) lines.push(`Уроки: проведено ${numbers.lessons.held}, пропущено ${numbers.lessons.missed}, отменено ${numbers.lessons.cancelled}`);
  if (numbers.homework) lines.push(`Домашки: сдано ${numbers.homework.submitted} из ${numbers.homework.due}`);
  if (numbers.words) lines.push(`Слова: новых ${numbers.words.added}, закрепилось ${numbers.words.learnt} из ${numbers.words.total}`);
  if (numbers.textbook) lines.push(`${numbers.textbook.title}: юнитов ${numbers.textbook.unitsPassed} из ${numbers.textbook.units}`);
  return lines;
}

/** «22 октября 2026 — 21 ноября 2026». */
export function periodLabel(from: string, to: string): string {
  return `${dateLabel(from)} — ${dateLabel(to)}`;
}

/** The blocks with text, in the teacher's order. */
export function filledBlocks(blocks: readonly ReportBlock[]): ReportBlock[] {
  return blocks.filter((b) => b.text.trim() !== "");
}

/**
 * The report as plain text for a messenger: the period, the numbers, the
 * filled blocks, the balance line when the teacher shows it, and the link
 * to the parent's page.
 */
export function reportText(report: {
  firstName: string;
  periodFrom: string;
  periodTo: string;
  numbers: ReportNumbers;
  blocks: readonly ReportBlock[];
  balance: string | null;
  link: string;
}): string {
  const parts = [`Отчёт: ${report.firstName}, ${periodLabel(report.periodFrom, report.periodTo)}`];
  const lines = numberLines(report.numbers);
  if (report.balance) lines.push(`Оплата: ${report.balance}`);
  if (lines.length > 0) parts.push(lines.join("\n"));
  for (const block of filledBlocks(report.blocks)) parts.push(`${block.title}\n${block.text.trim()}`);
  parts.push(`Подробнее: ${report.link}`);
  return parts.join("\n\n");
}
