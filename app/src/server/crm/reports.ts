// A parent's report drafted on the card (#267). The period runs from the
// day after the last published report to today in the student's time zone;
// the first one covers the last 30 days. The numbers of a draft are counted
// whenever it is shown, from the same sources as the card: results by skill
// (#255), the personal measure (#266), lessons, homework, words and the
// textbook. Publishing (#268) freezes the numbers and shows the report on
// the parent's page; the teacher may still edit its text, or take it down,
// which turns it back into a draft. The teacher's only until published.
import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { balanceLabel, computeBalance } from "../../domain/payments";
import { DEFAULT_BLOCKS, filledBlocks, FIRST_PERIOD_DAYS, type ReportBlock, type ReportNumbers, skillsInPeriod } from "../../domain/report";
import { addDays, dateIn, zonedMoment } from "../../domain/schedule";
import { measureLabel } from "../../domain/student";
import { MASTERED_STEP } from "../../domain/word-training";
import type { Database } from "../db/client";
import { homework, lesson, report, vocabularyWord } from "../db/schema";
import { chargedLessonDates } from "../schedule/schedule";
import { findGoal, measureValues } from "./goal";
import { listPayments, listTerms } from "./payments";
import { listSkillResults, progressTotals } from "./progress";
import { findStudent } from "./students";

export type ReportRow = {
  id: string;
  status: string;
  periodFrom: string;
  periodTo: string;
  blocks: ReportBlock[];
  showPayments: boolean;
  publishedAt: Date | null;
  numbers: ReportNumbers | null;
};

const columns = {
  id: report.id,
  status: report.status,
  periodFrom: report.periodFrom,
  periodTo: report.periodTo,
  blocks: report.blocks,
  showPayments: report.showPayments,
  publishedAt: report.publishedAt,
  numbers: report.numbers,
};

const toRow = (r: Omit<ReportRow, "blocks" | "numbers"> & { blocks: unknown; numbers: unknown }): ReportRow => ({
  ...r,
  blocks: r.blocks as ReportBlock[],
  numbers: (r.numbers as ReportNumbers | null) ?? null,
});

/** The student's reports, the newest period first. */
export async function listReports(db: Database, teacherId: string, studentId: string): Promise<ReportRow[]> {
  const rows = await db
    .select(columns)
    .from(report)
    .where(and(eq(report.teacherId, teacherId), eq(report.studentId, studentId)))
    .orderBy(desc(report.periodTo), desc(report.createdAt));
  return rows.map(toRow);
}

/** Where a new report starts: the day after the last published one ends, else 30 days back. */
export async function nextPeriodFrom(db: Database, teacherId: string, studentId: string, today: string): Promise<string> {
  const [last] = await db
    .select({ periodTo: report.periodTo })
    .from(report)
    .where(and(eq(report.teacherId, teacherId), eq(report.studentId, studentId), eq(report.status, "published")))
    .orderBy(desc(report.periodTo))
    .limit(1);
  const from = last ? addDays(last.periodTo, 1) : addDays(today, -FIRST_PERIOD_DAYS);
  return from > today ? today : from;
}

/**
 * «Новый отчёт»: the student's draft, created with the default blocks when
 * there is none — two calls never make two, the database keeps one draft
 * per student. An open draft runs to today, unless it was published once and
 * its numbers are frozen. Null for a student that is not
 * this teacher's.
 */
export async function openDraft(db: Database, teacherId: string, studentId: string, now: Date = new Date()): Promise<ReportRow | null> {
  const card = await findStudent(db, teacherId, studentId);
  if (!card) return null;
  const today = dateIn(now, card.timeZone);
  const from = await nextPeriodFrom(db, teacherId, studentId, today);
  await db
    .insert(report)
    .values({ teacherId, studentId, periodFrom: from, periodTo: today, blocks: DEFAULT_BLOCKS.map((title) => ({ title, text: "" })) })
    .onConflictDoNothing();
  const [draft] = await db
    .update(report)
    .set({ periodTo: sql`case when ${report.numbers} is null then greatest(${report.periodFrom}, ${today}::date) else ${report.periodTo} end` })
    .where(and(eq(report.teacherId, teacherId), eq(report.studentId, studentId), eq(report.status, "draft")))
    .returning(columns);
  return draft ? toRow(draft) : null;
}

/** Saves a report's blocks and «Показать оплаты», a draft or a published one; false when it is not this teacher's. */
export async function saveReport(
  db: Database,
  teacherId: string,
  reportId: string,
  draft: { blocks: ReportBlock[]; showPayments: boolean },
): Promise<boolean> {
  const rows = await db
    .update(report)
    .set({ blocks: draft.blocks, showPayments: draft.showPayments, updatedAt: new Date() })
    .where(and(eq(report.id, reportId), eq(report.teacherId, teacherId), inArray(report.status, ["draft", "published"])))
    .returning({ id: report.id });
  return rows.length > 0;
}

/**
 * «Опубликовать»: the draft goes to the parent's page. Its numbers freeze at
 * the first publishing — the counted ones are written only while none are —
 * and the write is conditional on it still being a draft. False when it is
 * not this teacher's draft.
 */
export async function publishReport(db: Database, teacherId: string, reportId: string, now: Date = new Date()): Promise<boolean> {
  const found = await findReport(db, teacherId, reportId);
  if (!found || found.status !== "draft") return false;
  const card = await findStudent(db, teacherId, found.studentId);
  if (!card) return false;
  const numbers = found.numbers ?? (await reportNumbers(db, teacherId, found.studentId, found.periodFrom, found.periodTo, card.timeZone));
  await db
    .update(report)
    .set({ numbers })
    .where(and(eq(report.id, reportId), eq(report.teacherId, teacherId), isNull(report.numbers)));
  const rows = await db
    .update(report)
    .set({ status: "published", publishedAt: sql`coalesce(${report.publishedAt}, ${now.toISOString()}::timestamptz)`, updatedAt: now })
    .where(and(eq(report.id, reportId), eq(report.teacherId, teacherId), eq(report.status, "draft")))
    .returning({ id: report.id });
  return rows.length > 0;
}

/**
 * «Снять с публикации»: the report is a draft again and leaves the parent's
 * page; its numbers stay frozen. "draft_exists" when the student already has
 * a draft — one per student — and "not_found" when it is not this teacher's
 * published report.
 */
export async function unpublishReport(db: Database, teacherId: string, reportId: string): Promise<"ok" | "draft_exists" | "not_found"> {
  try {
    const rows = await db
      .update(report)
      .set({ status: "draft", updatedAt: new Date() })
      .where(and(eq(report.id, reportId), eq(report.teacherId, teacherId), eq(report.status, "published")))
      .returning({ id: report.id });
    return rows.length > 0 ? "ok" : "not_found";
  } catch (error) {
    if ((error as { code?: string }).code === "23505" || (error as { cause?: { code?: string } }).cause?.code === "23505") return "draft_exists";
    throw error;
  }
}

/** The published reports of the student for the parent's page, newest first: the frozen numbers and the filled blocks, nothing else. */
export async function publishedReports(db: Database, teacherId: string, studentId: string) {
  const rows = await db
    .select(columns)
    .from(report)
    .where(and(eq(report.teacherId, teacherId), eq(report.studentId, studentId), eq(report.status, "published")))
    .orderBy(desc(report.periodTo), desc(report.publishedAt));
  return rows.map(toRow).map((r) => ({
    id: r.id,
    periodFrom: r.periodFrom,
    periodTo: r.periodTo,
    numbers: r.numbers!,
    blocks: filledBlocks(r.blocks),
  }));
}

/** One report of this teacher with its student, or null. */
export async function findReport(db: Database, teacherId: string, reportId: string) {
  const [row] = await db
    .select({ ...columns, studentId: report.studentId })
    .from(report)
    .where(and(eq(report.id, reportId), eq(report.teacherId, teacherId)));
  return row ? { ...toRow(row), studentId: row.studentId } : null;
}

/** The numbers of the period, from the student's dates `from` to `to` in their time zone. */
export async function reportNumbers(db: Database, teacherId: string, studentId: string, from: string, to: string, timeZone: string): Promise<ReportNumbers> {
  const start = zonedMoment(from, "00:00", timeZone);
  const end = zonedMoment(addDays(to, 1), "00:00", timeZone);
  const goal = await findGoal(db, teacherId, studentId);
  const values = goal?.measureName ? await measureValues(db, teacherId, studentId, start, new Date(end.getTime() - 1)) : [];
  const [lessons] = await db
    .select({
      held: sql<number>`count(*) filter (where ${lesson.status} = 'held')::int`,
      missed: sql<number>`count(*) filter (where ${lesson.status} = 'missed')::int`,
      cancelled: sql<number>`count(*) filter (where ${lesson.status} = 'cancelled')::int`,
    })
    .from(lesson)
    .where(and(eq(lesson.teacherId, teacherId), eq(lesson.studentId, studentId), gte(lesson.startsAt, start), lt(lesson.startsAt, end)));
  // Due is a homework submitted, or one given out whose deadline has passed
  // unsubmitted. Not "missed" alone: a homework becomes missed only when the
  // next one is published, so the latest overdue one is still "published",
  // and one closed early by the next is not yet due.
  const today = dateIn(new Date(), timeZone);
  const [work] = await db
    .select({
      submitted: sql<number>`count(*) filter (where ${homework.status} = 'submitted')::int`,
      overdue: sql<number>`count(*) filter (where ${homework.status} in ('published', 'missed') and ${homework.dueDate} < ${today})::int`,
    })
    .from(homework)
    .where(and(eq(homework.teacherId, teacherId), eq(homework.studentId, studentId), gte(homework.dueDate, from), sql`${homework.dueDate} <= ${to}`));
  const [words] = await db
    .select({
      added: sql<number>`count(*) filter (where ${vocabularyWord.createdAt} >= ${start.toISOString()} and ${vocabularyWord.createdAt} < ${end.toISOString()})::int`,
      learnt: sql<number>`count(*) filter (where ${gte(vocabularyWord.trainStep, MASTERED_STEP)})::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(vocabularyWord)
    .where(and(eq(vocabularyWord.teacherId, teacherId), eq(vocabularyWord.studentId, studentId)));
  const { textbook } = await progressTotals(db, teacherId, studentId);
  const held = lessons ?? { held: 0, missed: 0, cancelled: 0 };
  const due = (work?.submitted ?? 0) + (work?.overdue ?? 0);
  return {
    skills: skillsInPeriod(await listSkillResults(db, teacherId, studentId), from, to),
    measure: goal?.measureName ? measureLabel(goal.measureName, goal.measureUnit, values) : null,
    lessons: held.held + held.missed + held.cancelled > 0 ? held : null,
    homework: due > 0 ? { submitted: work!.submitted, due } : null,
    words: words && words.total > 0 ? words : null,
    textbook,
  };
}

/** The balance line «Показать оплаты» adds, as the card says it; null when there is no balance to show. */
export async function balanceLine(db: Database, teacherId: string, studentId: string, today: string): Promise<string | null> {
  const [history, payments, charged] = await Promise.all([
    listTerms(db, teacherId, studentId),
    listPayments(db, teacherId, studentId),
    chargedLessonDates(db, teacherId, studentId),
  ]);
  const balance = computeBalance(history, payments, charged, today);
  return balance ? balanceLabel(balance) : null;
}
