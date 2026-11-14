import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, dateIn, mondayOf, timeIn, weekdayOf } from "../../../domain/schedule";
import { closeDb, db } from "../../db/client";
import { withStudentLocked } from "../../access/links";
import { lesson, student } from "../../db/schema";
import { removeFutureLessons, topUpLessons } from "../../schedule/schedule";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller } from "../index";

// The schedule (#80).

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];

let teacher: ReturnType<typeof createServerCaller>;
let otherTeacher: ReturnType<typeof createServerCaller>;
let teacherId: string;
const base = { lastName: "", level: "A2" as const, timeZone: "Europe/Moscow" as const };

async function newStudent(firstName: string) {
  return (await teacher.teacher.students.create({ ...base, firstName })).id;
}

const lessonsOf = (studentId: string) =>
  db().select().from(lesson).where(eq(lesson.studentId, studentId)).orderBy(lesson.startsAt);

/** Two days ahead in Moscow: never "today", whenever this runs. */
const ahead = (days: number) => addDays(dateIn(new Date(), "Europe/Moscow"), days);

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  otherTeacher = createServerCaller(await signedInHeaders(teacherB));
  teacherId = (await teacher.teacher.session.me()).id;
  await teacher.teacher.settings.save({ timeZone: "Asia/Bangkok" });
});

afterAll(closeDb);

describe("teacher.schedule", () => {
  it("creates a slot's lessons 4 weeks ahead at the student's local time, and only once", async () => {
    const studentId = await newStudent("Слот");
    const first = ahead(2);
    await teacher.teacher.schedule.addSlot({ studentId, weekday: weekdayOf(first), startTime: "17:00", durationMinutes: 60 });

    const lessons = await lessonsOf(studentId);
    expect(lessons.map((l) => dateIn(l.startsAt, "Europe/Moscow"))).toEqual([0, 7, 14, 21].map((d) => addDays(first, d)));
    expect(lessons.every((l) => timeIn(l.startsAt, "Europe/Moscow") === "17:00" && l.durationMinutes === 60)).toBe(true);
    expect(await teacher.teacher.schedule.slots({ studentId })).toEqual([
      expect.objectContaining({ weekday: weekdayOf(first), startTime: "17:00", durationMinutes: 60 }),
    ]);

    // Topping up again, or a week later, never doubles a lesson.
    await topUpLessons(db(), teacherId);
    await topUpLessons(db(), teacherId, new Date(Date.now() + 7 * 86_400_000));
    const after = await lessonsOf(studentId);
    expect(new Set(after.map((l) => l.slotDate)).size).toBe(after.length);
    expect(after.length).toBe(5);
  });

  it("shows the week in the teacher's time zone with the student's zone alongside", async () => {
    const studentId = await newStudent("Неделя");
    const date = ahead(2);
    await teacher.teacher.schedule.addSlot({ studentId, weekday: weekdayOf(date), startTime: "17:00", durationMinutes: 45 });
    const week = await teacher.teacher.schedule.week({ monday: mondayOf(date) });
    expect(week.timeZone).toBe("Asia/Bangkok");
    const found = week.lessons.find((l) => l.studentName === "Неделя")!;
    expect(found).toMatchObject({ studentTimeZone: "Europe/Moscow", durationMinutes: 45, kind: "regular" });
    expect(timeIn(new Date(found.startsAt), "Asia/Bangkok")).toBe("21:00");

    await teacher.teacher.settings.save({ timeZone: "Europe/Moscow" });
    expect((await teacher.teacher.settings.get()).timeZone).toBe("Europe/Moscow");
    const moscow = await teacher.teacher.schedule.week({ monday: mondayOf(date) });
    expect(moscow.lessons.find((l) => l.studentName === "Неделя")!.startsAt).toBe(found.startsAt);
    await teacher.teacher.settings.save({ timeZone: "Asia/Bangkok" });
  });

  it("adds a one-off and an introductory lesson at the student's local time", async () => {
    const studentId = await newStudent("Разовый");
    await teacher.teacher.schedule.addLesson({ studentId, date: ahead(3), time: "10:00", durationMinutes: 90, intro: true });
    const [made] = await lessonsOf(studentId);
    expect(made).toMatchObject({ kind: "intro", durationMinutes: 90, slotId: null });
    expect(timeIn(made!.startsAt, "Europe/Moscow")).toBe("10:00");
  });

  it("takes future lessons off on pause and at «Завершили», and brings them back", async () => {
    const studentId = await newStudent("Пауза");
    await teacher.teacher.schedule.addSlot({
      studentId,
      weekday: weekdayOf(ahead(2)),
      startTime: "12:00",
      durationMinutes: 60,
    });
    expect(await lessonsOf(studentId)).toHaveLength(4);
    const update = (status: "paused" | "finished" | "active") =>
      teacher.teacher.students.update({ ...base, firstName: "Пауза", id: studentId, status });

    await update("paused");
    expect(await lessonsOf(studentId)).toHaveLength(0);
    await update("active");
    expect(await lessonsOf(studentId)).toHaveLength(4);
    await update("finished");
    expect(await lessonsOf(studentId)).toHaveLength(0);
  });

  it("does not top up a student whose pause is being saved", async () => {
    const studentId = await newStudent("Гонка");
    await teacher.teacher.schedule.addSlot({ studentId, weekday: weekdayOf(ahead(2)), startTime: "12:00", durationMinutes: 60 });
    await db().delete(lesson).where(eq(lesson.studentId, studentId));

    // The pause holds the student row, as the status change does...
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held!: () => void;
    const holding = new Promise<void>((resolve) => (held = resolve));
    const pausing = withStudentLocked(db(), teacherId, studentId, async (tx) => {
      await tx.update(student).set({ status: "paused" }).where(eq(student.id, studentId));
      await removeFutureLessons(tx, teacherId, studentId);
      held();
      await gate;
    });
    await holding;

    // ...so a week read that started meanwhile waits for it and sees the pause.
    let toppedUp = false;
    const topping = topUpLessons(db(), teacherId, new Date(), studentId).then(() => (toppedUp = true));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(toppedUp).toBe(false);

    release();
    await Promise.all([pausing, topping]);
    expect(await lessonsOf(studentId)).toHaveLength(0);
  });

  it("keeps another teacher out", async () => {
    const studentId = await newStudent("Чужой");
    await teacher.teacher.schedule.addSlot({ studentId, weekday: weekdayOf(ahead(2)), startTime: "15:00", durationMinutes: 60 });
    for (const call of [
      () => otherTeacher.teacher.schedule.slots({ studentId }),
      () => otherTeacher.teacher.schedule.addSlot({ studentId, weekday: 1, startTime: "10:00", durationMinutes: 60 }),
      () =>
        otherTeacher.teacher.schedule.addLesson({ studentId, date: ahead(3), time: "10:00", durationMinutes: 60, intro: false }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    const week = await otherTeacher.teacher.schedule.week({ monday: mondayOf(ahead(2)) });
    expect(week.lessons.some((l) => l.studentName === "Чужой")).toBe(false);
  });
});
