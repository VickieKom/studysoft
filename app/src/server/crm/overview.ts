// «Главная», the teacher's general screen (#257): the lessons ahead, every
// student with their numbers, and what needs the teacher — a slip in a
// skill, a homework not submitted, prepaid lessons running out. Built from
// the same sources as the card's blocks; nothing here is new data.
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { LessonPlan } from "../../domain/lesson-plan";
import { balanceLabel, computeBalance } from "../../domain/payments";
import { type Skill, skillsByMonth, slips } from "../../domain/progress";
import { dateIn } from "../../domain/schedule";
import { ACTIVE_STATUSES, STATUSES } from "../../domain/student";
import { teacherTimeZone } from "../access/settings";
import type { Database } from "../db/client";
import { homework, lessonPlan } from "../db/schema";
import { nextBookLesson, orderedLessons, studentWithTextbook, upcomingLessons } from "../lesson/prep";
import { chargedLessonDates } from "../schedule/schedule";
import { listPayments, listTerms } from "./payments";
import { listSkillResults, progressTotals } from "./progress";
import { listStudents } from "./students";

export type HomeworkState = "published" | "submitted" | "missed";

/**
 * The student's latest homework given out — published, submitted or missed —
 * and whether it is not submitted: missed, or published with its due date
 * passed in the student's time zone.
 */
async function latestHomework(db: Database, teacherId: string, studentId: string, today: string) {
  const [latest] = await db
    .select({ status: homework.status, dueDate: homework.dueDate })
    .from(homework)
    .where(and(eq(homework.teacherId, teacherId), eq(homework.studentId, studentId), ne(homework.status, "draft")))
    .orderBy(desc(homework.publishedAt), desc(homework.createdAt))
    .limit(1);
  if (!latest) return { status: null, notSubmitted: false };
  const status = latest.status as HomeworkState;
  return { status, notSubmitted: status === "missed" || (status === "published" && latest.dueDate !== null && latest.dueDate < today) };
}

/** The balance label when the student is prepaid with one lesson or less left, as the card warns; otherwise null. */
async function runningOut(db: Database, teacherId: string, studentId: string, today: string): Promise<string | null> {
  const [history, payments, charged] = await Promise.all([
    listTerms(db, teacherId, studentId),
    listPayments(db, teacherId, studentId),
    chargedLessonDates(db, teacherId, studentId),
  ]);
  const balance = computeBalance(history, payments, charged, today);
  return balance?.runningOut ? balanceLabel(balance) : null;
}

/** The book lesson a lesson covers: the plan's book stage, else the next lesson of the student's textbook. */
async function bookLessonOf(db: Database, teacherId: string, studentId: string, plan: LessonPlan | null) {
  const found = await studentWithTextbook(db, teacherId, studentId);
  if (!found?.textbookId || !found.textbookTitle) return null;
  const lessons = orderedLessons(found.structure);
  const stage = plan?.stages.findLast((s) => s.type === "book");
  const planned = stage?.type === "book" ? lessons.find((l) => l.id === stage.lessonId) : undefined;
  const book = planned ?? (await nextBookLesson(db, teacherId, studentId));
  return book ? `${found.textbookTitle} · ${book.label}` : found.textbookTitle;
}

// shortcut: a few queries per student, fine for one tutor's dozens of students; aggregate in SQL past that (#257)
export async function teacherOverview(db: Database, teacherId: string, now: Date = new Date()) {
  const timeZone = await teacherTimeZone(db, teacherId);
  const everyone = await listStudents(db, teacherId, STATUSES);
  const zoneOf = new Map(everyone.map((s) => [s.id, s.timeZone]));

  const ahead = await upcomingLessons(db, teacherId, undefined, now);
  const plans = ahead.length
    ? await db
        .select({ lessonId: lessonPlan.lessonId, plan: lessonPlan.plan })
        .from(lessonPlan)
        .where(and(eq(lessonPlan.teacherId, teacherId), inArray(lessonPlan.lessonId, ahead.map((l) => l.id))))
    : [];
  const planOf = new Map(plans.map((p) => [p.lessonId, (p.plan as LessonPlan | null) ?? null]));

  const students = [];
  const homeworkOf = new Map<string, HomeworkState | null>();
  for (const s of everyone) {
    const today = dateIn(now, s.timeZone);
    const work = await latestHomework(db, teacherId, s.id, today);
    homeworkOf.set(s.id, work.status);
    if (!ACTIVE_STATUSES.includes(s.status)) continue;
    const { rows } = skillsByMonth(await listSkillResults(db, teacherId, s.id));
    const totals = await progressTotals(db, teacherId, s.id);
    students.push({
      id: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
      status: s.status,
      textbook: totals.textbook,
      homework: totals.homework,
      trends: rows.flatMap((r) => (r.trend === null ? [] : [{ skill: r.skill as Skill, trend: r.trend }])),
      slips: slips(rows),
      homeworkNotSubmitted: work.notSubmitted,
      runningOut: await runningOut(db, teacherId, s.id, today),
    });
  }

  const lessons = [];
  for (const l of ahead) {
    lessons.push({
      id: l.id,
      studentId: l.studentId,
      firstName: l.firstName,
      startsAt: l.startsAt,
      durationMinutes: l.durationMinutes,
      studentTimeZone: zoneOf.get(l.studentId) ?? timeZone,
      book: await bookLessonOf(db, teacherId, l.studentId, planOf.get(l.id) ?? null),
      homework: homeworkOf.get(l.studentId) ?? null,
      prepared: l.prepared,
    });
  }
  return { timeZone, lessons, students };
}
