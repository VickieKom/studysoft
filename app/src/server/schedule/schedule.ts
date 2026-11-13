// The schedule (#80): weekly slots, lessons created from them ahead of time,
// one-off lessons, and the teacher's week. Time rules are in
// domain/schedule.ts (architecture 8.6).
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { addDays, dateIn, LESSONS_AHEAD_DAYS, mondayOf, slotDates, zonedMoment } from "../../domain/schedule";
import type { Database } from "../db/client";
import type { Queries } from "../access/links";
import { teacherTimeZone } from "../access/settings";
import { lesson, scheduleSlot, student } from "../db/schema";

/** Students whose slots make lessons: not on pause and not finished. */
const SCHEDULED_STATUSES = ["discussion", "active"];

/** The database or a transaction on it: what the functions below need of either. */
type Db = Pick<Database, "select" | "insert" | "update" | "delete">;

export type Slot = {
  id: string;
  weekday: number;
  startTime: string;
  durationMinutes: number;
  validFrom: string;
  validUntil: string | null;
};

/**
 * The student's weekly slots that are in force today or will be: one that
 * was changed from a date shows until that date, next to the one after it
 * (#81). Today is the student's.
 */
export async function listSlots(db: Database, teacherId: string, studentId: string, now: Date = new Date()): Promise<Slot[]> {
  const owner = await studentOf(db, teacherId, studentId);
  if (!owner) return [];
  return db
    .select({
      id: scheduleSlot.id,
      weekday: scheduleSlot.weekday,
      startTime: scheduleSlot.startTime,
      durationMinutes: scheduleSlot.durationMinutes,
      validFrom: scheduleSlot.validFrom,
      validUntil: scheduleSlot.validUntil,
    })
    .from(scheduleSlot)
    .where(
      and(
        eq(scheduleSlot.teacherId, teacherId),
        eq(scheduleSlot.studentId, studentId),
        or(isNull(scheduleSlot.validUntil), gte(scheduleSlot.validUntil, dateIn(now, owner.timeZone))),
        // A slot ended before it began was replaced the same day it started.
        or(isNull(scheduleSlot.validUntil), gte(scheduleSlot.validUntil, scheduleSlot.validFrom)),
      ),
    )
    .orderBy(asc(scheduleSlot.weekday), asc(scheduleSlot.validFrom), asc(scheduleSlot.startTime));
}

async function studentOf(db: Db, teacherId: string, studentId: string) {
  const [row] = await db
    .select({ timeZone: student.timeZone, status: student.status })
    .from(student)
    .where(and(eq(student.id, studentId), eq(student.teacherId, teacherId), isNull(student.deletedAt)));
  return row ?? null;
}

/**
 * Adds a weekly slot in the student's time zone, in force from the student's
 * today, and creates its lessons ahead. Null for no such student.
 */
export async function addSlot(
  db: Database,
  teacherId: string,
  studentId: string,
  slot: { weekday: number; startTime: string; durationMinutes: number },
  now: Date = new Date(),
): Promise<string | null> {
  const owner = await studentOf(db, teacherId, studentId);
  if (!owner) return null;
  const [row] = await db
    .insert(scheduleSlot)
    .values({ teacherId, studentId, ...slot, timeZone: owner.timeZone, validFrom: dateIn(now, owner.timeZone) })
    .returning({ id: scheduleSlot.id });
  if (!row) throw new Error("addSlot: insert returned no row");
  await topUpLessons(db, teacherId, now, studentId);
  return row.id;
}

/**
 * Creates the lessons of every slot in force for the next 4 weeks that do
 * not exist yet. Idempotent: a slot makes one lesson per date, whatever
 * happened to it since. Students on pause or finished get none.
 */
export async function topUpLessons(db: Queries, teacherId: string, now: Date = new Date(), studentId?: string) {
  await db.transaction(async (tx) => {
    // Share-lock the students first, so a status change in flight either
    // finishes before the slots are read, and this sees the pause, or waits
    // for the lessons to land and then removes them. Ordered by id so two
    // week reads never lock in opposite orders.
    const students = await tx
      .select({ id: student.id })
      .from(student)
      .where(
        and(
          eq(student.teacherId, teacherId),
          isNull(student.deletedAt),
          inArray(student.status, SCHEDULED_STATUSES),
          studentId ? eq(student.id, studentId) : undefined,
        ),
      )
      .orderBy(asc(student.id))
      .for("share");
    if (students.length === 0) return;
    const slots = await tx
      .select({
        id: scheduleSlot.id,
        studentId: scheduleSlot.studentId,
        weekday: scheduleSlot.weekday,
        startTime: scheduleSlot.startTime,
        timeZone: scheduleSlot.timeZone,
        durationMinutes: scheduleSlot.durationMinutes,
        validFrom: scheduleSlot.validFrom,
        validUntil: scheduleSlot.validUntil,
      })
      .from(scheduleSlot)
      .where(
        and(
          eq(scheduleSlot.teacherId, teacherId),
          inArray(
            scheduleSlot.studentId,
            students.map((row) => row.id),
          ),
        ),
      );

    const rows = slots.flatMap((slot) => {
      const today = dateIn(now, slot.timeZone);
      return slotDates(slot.weekday, today, LESSONS_AHEAD_DAYS)
        .filter((date) => date >= slot.validFrom && (!slot.validUntil || date <= slot.validUntil))
        .map((date) => ({
          teacherId,
          studentId: slot.studentId,
          slotId: slot.id,
          slotDate: date,
          startsAt: zonedMoment(date, slot.startTime, slot.timeZone),
          durationMinutes: slot.durationMinutes,
        }))
        .filter((row) => row.startsAt > now);
    });
    if (rows.length > 0) await tx.insert(lesson).values(rows).onConflictDoNothing();
  });
}

/** A one-off lesson at the student's local date and time. Null for no such student. */
export async function addLesson(
  db: Database,
  teacherId: string,
  studentId: string,
  input: { date: string; time: string; durationMinutes: number; intro: boolean },
): Promise<string | null> {
  const owner = await studentOf(db, teacherId, studentId);
  if (!owner) return null;
  const [row] = await db
    .insert(lesson)
    .values({
      teacherId,
      studentId,
      startsAt: zonedMoment(input.date, input.time, owner.timeZone),
      durationMinutes: input.durationMinutes,
      kind: input.intro ? "intro" : "regular",
    })
    .returning({ id: lesson.id });
  if (!row) throw new Error("addLesson: insert returned no row");
  return row.id;
}

/** «На паузе» and «Завершили» take the student's future lessons off the schedule. */
export async function removeFutureLessons(db: Queries, teacherId: string, studentId: string, now: Date = new Date()) {
  await db
    .delete(lesson)
    .where(
      and(
        eq(lesson.teacherId, teacherId),
        eq(lesson.studentId, studentId),
        gt(lesson.startsAt, now),
        eq(lesson.status, "scheduled"),
      ),
    );
}

export type WeekLesson = {
  id: string;
  studentId: string;
  studentName: string;
  studentTimeZone: string;
  startsAt: Date;
  durationMinutes: number;
  kind: string;
  status: string;
  charged: boolean | null;
  unit: string | null;
  note: string | null;
  movedFrom: Date | null;
  meetingLink: string | null;
};

const markColumns = { status: lesson.status, charged: lesson.charged, unit: lesson.unit, note: lesson.note };

/** A lesson that has ended and is not marked yet asks to be marked (#82). */
export function needsMark(l: { status: string; startsAt: Date; durationMinutes: number }, now: Date = new Date()): boolean {
  return l.status === "scheduled" && l.startsAt.getTime() + l.durationMinutes * 60_000 <= now.getTime();
}

export type LessonMark = { status: "held" | "missed"; charged: boolean; unit: string | null; note: string | null };

/**
 * Marks a lesson of this teacher that has started: held or missed, charged
 * or not, the unit covered and a note. It can be marked again at any time.
 * An introductory lesson is free and never charged. False when there is no
 * such lesson yet.
 */
export async function markLesson(
  db: Database,
  teacherId: string,
  lessonId: string,
  mark: LessonMark,
  now: Date = new Date(),
): Promise<boolean> {
  const [row] = await db
    .select({ kind: lesson.kind })
    .from(lesson)
    .where(and(eq(lesson.id, lessonId), eq(lesson.teacherId, teacherId), lte(lesson.startsAt, now)));
  if (!row) return false;
  await db
    .update(lesson)
    .set({ ...mark, charged: row.kind === "intro" ? false : mark.charged, updatedAt: now })
    .where(eq(lesson.id, lessonId));
  return true;
}

export type HistoryLesson = {
  id: string;
  startsAt: Date;
  durationMinutes: number;
  kind: string;
  status: string;
  charged: boolean | null;
  unit: string | null;
  note: string | null;
};

/** The student's lessons that have started, newest first: the history on the card (#82). */
export async function lessonHistory(
  db: Database,
  teacherId: string,
  studentId: string,
  now: Date = new Date(),
): Promise<HistoryLesson[]> {
  return db
    .select({
      id: lesson.id,
      startsAt: lesson.startsAt,
      durationMinutes: lesson.durationMinutes,
      kind: lesson.kind,
      ...markColumns,
    })
    .from(lesson)
    .where(and(eq(lesson.teacherId, teacherId), eq(lesson.studentId, studentId), lte(lesson.startsAt, now)))
    .orderBy(desc(lesson.startsAt));
}

/**
 * The lessons of the week that starts on `monday` in the teacher's time zone,
 * after topping up the lessons ahead. Another teacher's never show.
 */
export async function weekLessons(db: Database, teacherId: string, monday: string, now: Date = new Date()) {
  await topUpLessons(db, teacherId, now);
  const zone = await teacherTimeZone(db, teacherId);
  const from = zonedMoment(monday, "00:00", zone);
  const to = zonedMoment(addDays(monday, 7), "00:00", zone);
  const lessons: WeekLesson[] = await db
    .select({
      id: lesson.id,
      studentId: lesson.studentId,
      studentName: student.firstName,
      studentTimeZone: student.timeZone,
      startsAt: lesson.startsAt,
      durationMinutes: lesson.durationMinutes,
      kind: lesson.kind,
      ...markColumns,
      movedFrom: lesson.movedFrom,
      meetingLink: lesson.meetingLink,
    })
    .from(lesson)
    .innerJoin(student, and(eq(student.id, lesson.studentId), isNull(student.deletedAt)))
    .where(and(eq(lesson.teacherId, teacherId), gte(lesson.startsAt, from), lt(lesson.startsAt, to)))
    .orderBy(asc(lesson.startsAt));
  return { timeZone: zone, lessons };
}

/**
 * The student's dates (in the student's time zone) of every charged lesson:
 * held, missed or cancelled with «Списать» (#82, #83). The balance charges
 * each at the price of its date.
 */
export async function chargedLessonDates(db: Database, teacherId: string, studentId: string): Promise<string[]> {
  const rows = await db
    .select({ startsAt: lesson.startsAt, timeZone: student.timeZone })
    .from(lesson)
    .innerJoin(student, eq(student.id, lesson.studentId))
    .where(and(eq(lesson.teacherId, teacherId), eq(lesson.studentId, studentId), eq(lesson.charged, true)));
  return rows.map((r) => dateIn(r.startsAt, r.timeZone));
}

// Changes to the schedule (#81): moving and cancelling one lesson, changing a
// slot from a date, overlaps and the meeting link.

/** The lesson's student's time zone, for a lesson of this teacher in one of these statuses. */
async function lessonOf(db: Db, teacherId: string, lessonId: string, statuses: string[]) {
  const [row] = await db
    .select({ startsAt: lesson.startsAt, movedFrom: lesson.movedFrom, kind: lesson.kind, timeZone: student.timeZone })
    .from(lesson)
    .innerJoin(student, and(eq(student.id, lesson.studentId), isNull(student.deletedAt)))
    .where(and(eq(lesson.id, lessonId), eq(lesson.teacherId, teacherId), inArray(lesson.status, statuses)));
  return row ?? null;
}

/**
 * «Перенести»: a lesson not marked or cancelled goes to another date and time
 * in the student's time zone. It keeps when it was first planned, for
 * «перенесён с …», and its slot date, so the slot never makes it again. Back
 * at its first time it is no longer moved. False when there is no such lesson.
 */
export async function moveLesson(
  db: Database,
  teacherId: string,
  lessonId: string,
  to: { date: string; time: string },
  now: Date = new Date(),
): Promise<boolean> {
  const row = await lessonOf(db, teacherId, lessonId, ["scheduled"]);
  if (!row) return false;
  const startsAt = zonedMoment(to.date, to.time, row.timeZone);
  const first = row.movedFrom ?? row.startsAt;
  await db
    .update(lesson)
    .set({ startsAt, movedFrom: first.getTime() === startsAt.getTime() ? null : first, updatedAt: now })
    .where(eq(lesson.id, lessonId));
  return true;
}

/**
 * «Отменить урок»: the lesson stays on the week as cancelled, charged or not
 * as the teacher chose; an introductory lesson is never charged. A cancelled
 * lesson can be saved again with another choice, or put back on the schedule.
 * False when there is no such lesson or it is marked already.
 */
export async function cancelLesson(
  db: Database,
  teacherId: string,
  lessonId: string,
  charged: boolean,
  now: Date = new Date(),
): Promise<boolean> {
  const row = await lessonOf(db, teacherId, lessonId, ["scheduled", "cancelled"]);
  if (!row) return false;
  await db
    .update(lesson)
    .set({ status: "cancelled", charged: row.kind === "intro" ? false : charged, updatedAt: now })
    .where(eq(lesson.id, lessonId));
  return true;
}

/** «Вернуть в расписание»: a cancelled lesson is scheduled again and not charged. */
export async function restoreLesson(db: Database, teacherId: string, lessonId: string, now: Date = new Date()) {
  const rows = await db
    .update(lesson)
    .set({ status: "scheduled", charged: null, updatedAt: now })
    .where(and(eq(lesson.id, lessonId), eq(lesson.teacherId, teacherId), eq(lesson.status, "cancelled")))
    .returning({ id: lesson.id });
  return rows.length > 0;
}

/** «Ссылка на встречу» of one lesson; null clears it. False when there is no such lesson. */
export async function setMeetingLink(db: Database, teacherId: string, lessonId: string, link: string | null, now = new Date()) {
  const rows = await db
    .update(lesson)
    .set({ meetingLink: link, updatedAt: now })
    .where(and(eq(lesson.id, lessonId), eq(lesson.teacherId, teacherId)))
    .returning({ id: lesson.id });
  return rows.length > 0;
}

/**
 * The first names of the teacher's students with a lesson, not cancelled,
 * that overlaps this time: the student's local date and time and a duration.
 * The lesson being moved does not overlap itself. Null for no such student.
 */
export async function overlaps(
  db: Database,
  teacherId: string,
  studentId: string,
  at: { date: string; time: string; durationMinutes: number; exceptLessonId?: string },
): Promise<string[] | null> {
  const owner = await studentOf(db, teacherId, studentId);
  if (!owner) return null;
  const start = zonedMoment(at.date, at.time, owner.timeZone);
  const end = new Date(start.getTime() + at.durationMinutes * 60_000);
  const rows = await db
    .selectDistinct({ name: student.firstName, startsAt: lesson.startsAt })
    .from(lesson)
    .innerJoin(student, and(eq(student.id, lesson.studentId), isNull(student.deletedAt)))
    .where(
      and(
        eq(lesson.teacherId, teacherId),
        ne(lesson.status, "cancelled"),
        at.exceptLessonId ? ne(lesson.id, at.exceptLessonId) : undefined,
        lt(lesson.startsAt, end),
        // A raw parameter goes as text: the moment is passed as ISO and cast.
        sql`${lesson.startsAt} + ${lesson.durationMinutes} * interval '1 minute' > ${start.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(asc(lesson.startsAt));
  return [...new Set(rows.map((r) => r.name))];
}

/** The date of `weekday` in the Monday-first week of `date`. */
const sameWeek = (date: string, weekday: number) => addDays(mondayOf(date), (weekday + 6) % 7);

/**
 * «Изменить слот» from a date (in the student's time zone, not before the
 * student's today): the slot ends the day before, and a new one with the new
 * day, time and duration starts that date. Its lessons from that date that
 * are still as the slot made them are replaced; the ones the teacher moved,
 * cancelled or marked stay where they are and count for the new slot's week,
 * so it makes no second lesson that week. Null for no such slot in force;
 * "past" for a date before the student's today.
 */
export async function changeSlot(
  db: Database,
  teacherId: string,
  slotId: string,
  change: { weekday: number; startTime: string; durationMinutes: number; from: string },
  now: Date = new Date(),
): Promise<string | null | "past"> {
  return db.transaction(async (tx) => {
    const [old] = await tx
      .select({ studentId: scheduleSlot.studentId, timeZone: student.timeZone })
      .from(scheduleSlot)
      .innerJoin(student, and(eq(student.id, scheduleSlot.studentId), isNull(student.deletedAt)))
      .where(and(eq(scheduleSlot.id, slotId), eq(scheduleSlot.teacherId, teacherId), isNull(scheduleSlot.validUntil)))
      .for("update", { of: scheduleSlot });
    if (!old) return null;
    if (change.from < dateIn(now, old.timeZone)) return "past";

    await tx.update(scheduleSlot).set({ validUntil: addDays(change.from, -1) }).where(eq(scheduleSlot.id, slotId));
    const [created] = await tx
      .insert(scheduleSlot)
      .values({
        teacherId,
        studentId: old.studentId,
        weekday: change.weekday,
        startTime: change.startTime,
        durationMinutes: change.durationMinutes,
        timeZone: old.timeZone,
        validFrom: change.from,
      })
      .returning({ id: scheduleSlot.id });
    if (!created) throw new Error("changeSlot: insert returned no row");

    const fromDate = and(eq(lesson.slotId, slotId), gte(lesson.slotDate, change.from));
    await tx
      .delete(lesson)
      .where(and(fromDate, eq(lesson.status, "scheduled"), isNull(lesson.movedFrom), gt(lesson.startsAt, now)));
    const kept = await tx.select({ id: lesson.id, slotDate: lesson.slotDate }).from(lesson).where(fromDate);
    for (const row of kept) {
      if (!row.slotDate) continue;
      await tx
        .update(lesson)
        .set({ slotId: created.id, slotDate: sameWeek(row.slotDate, change.weekday) })
        .where(eq(lesson.id, row.id));
    }
    await topUpLessons(tx, teacherId, now, old.studentId);
    return created.id;
  });
}
