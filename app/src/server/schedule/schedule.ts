// The schedule (#80): weekly slots, lessons created from them ahead of time,
// one-off lessons, and the teacher's week. Time rules are in
// domain/schedule.ts (architecture 8.6).
import { and, asc, eq, gt, gte, inArray, isNull, lt } from "drizzle-orm";
import { addDays, dateIn, LESSONS_AHEAD_DAYS, slotDates, zonedMoment } from "../../domain/schedule";
import type { Database } from "../db/client";
import { teacherTimeZone } from "../access/settings";
import { lesson, scheduleSlot, student } from "../db/schema";

/** Students whose slots make lessons: not on pause and not finished. */
const SCHEDULED_STATUSES = ["discussion", "active"];

export type Slot = { id: string; weekday: number; startTime: string; durationMinutes: number };

/** The student's weekly slots that are in force. */
export async function listSlots(db: Database, teacherId: string, studentId: string): Promise<Slot[]> {
  return db
    .select({
      id: scheduleSlot.id,
      weekday: scheduleSlot.weekday,
      startTime: scheduleSlot.startTime,
      durationMinutes: scheduleSlot.durationMinutes,
    })
    .from(scheduleSlot)
    .where(and(eq(scheduleSlot.teacherId, teacherId), eq(scheduleSlot.studentId, studentId), isNull(scheduleSlot.validUntil)))
    .orderBy(asc(scheduleSlot.weekday), asc(scheduleSlot.startTime));
}

async function studentOf(db: Database, teacherId: string, studentId: string) {
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
export async function topUpLessons(db: Database, teacherId: string, now: Date = new Date(), studentId?: string) {
  const slots = await db
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
    .innerJoin(
      student,
      and(eq(student.id, scheduleSlot.studentId), isNull(student.deletedAt), inArray(student.status, SCHEDULED_STATUSES)),
    )
    .where(and(eq(scheduleSlot.teacherId, teacherId), studentId ? eq(scheduleSlot.studentId, studentId) : undefined));

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
  if (rows.length > 0) await db.insert(lesson).values(rows).onConflictDoNothing();
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
export async function removeFutureLessons(db: Database, teacherId: string, studentId: string, now: Date = new Date()) {
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
  studentName: string;
  studentTimeZone: string;
  startsAt: Date;
  durationMinutes: number;
  kind: string;
};

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
      studentName: student.firstName,
      studentTimeZone: student.timeZone,
      startsAt: lesson.startsAt,
      durationMinutes: lesson.durationMinutes,
      kind: lesson.kind,
    })
    .from(lesson)
    .innerJoin(student, and(eq(student.id, lesson.studentId), isNull(student.deletedAt)))
    .where(and(eq(lesson.teacherId, teacherId), gte(lesson.startsAt, from), lt(lesson.startsAt, to)))
    .orderBy(asc(lesson.startsAt));
  return { timeZone: zone, lessons };
}
