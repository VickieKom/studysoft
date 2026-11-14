import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, dateIn, mondayOf, weekdayOf } from "../../../domain/schedule";
import { closeDb } from "../../db/client";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller } from "../index";

// Moving and cancelling lessons, changing a slot from a date, overlaps and
// the meeting link (#81).

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];

let teacher: ReturnType<typeof createServerCaller>;
let otherTeacher: ReturnType<typeof createServerCaller>;
const base = { lastName: "", level: "A2" as const, timeZone: "Europe/Moscow" as const };
const moscow = (days: number) => addDays(dateIn(new Date(), "Europe/Moscow"), days);

async function student(firstName: string) {
  return (await teacher.teacher.students.create({ ...base, firstName })).id;
}

async function lessonOn(studentId: string, date: string, time = "10:00") {
  return (await teacher.teacher.schedule.addLesson({ studentId, date, time, durationMinutes: 60, intro: false })).id;
}

/** The student's lessons in the week of this date (the teacher is in Moscow here). */
async function lessonsInWeekOf(date: string, studentId: string) {
  const week = await teacher.teacher.schedule.week({ monday: mondayOf(date) });
  return week.lessons.filter((l) => l.studentId === studentId);
}

/** The student's lessons on this Moscow date. */
async function lessonsOn(date: string, studentId: string) {
  return (await lessonsInWeekOf(date, studentId)).filter((l) => dateIn(new Date(l.startsAt), "Europe/Moscow") === date);
}

const moscowTime = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(iso),
  );

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  otherTeacher = createServerCaller(await signedInHeaders(teacherB));
  await teacher.teacher.settings.save({ timeZone: "Europe/Moscow" });
});

afterAll(closeDb);

describe("moving a lesson", () => {
  it("keeps where it came from, and the slot makes no second lesson for that date", async () => {
    const studentId = await student("Перенос");
    const first = moscow(2);
    await teacher.teacher.schedule.addSlot({ studentId, weekday: weekdayOf(first), startTime: "17:00", durationMinutes: 60 });
    const [lesson] = await lessonsOn(first, studentId);
    if (!lesson) throw new Error("no lesson from the slot");

    await teacher.teacher.schedule.move({ lessonId: lesson.id, date: addDays(first, 1), time: "18:00" });
    // Reading the week tops the lessons up again: the slot's date is still taken.
    expect(await lessonsOn(first, studentId)).toEqual([]);
    const moved = await lessonsOn(addDays(first, 1), studentId);
    expect(moved).toEqual([expect.objectContaining({ id: lesson.id, movedFrom: lesson.startsAt })]);
    expect(moscowTime(moved[0]!.startsAt)).toBe("18:00");

    const [next] = await lessonsOn(addDays(first, 7), studentId);
    expect(next).toMatchObject({ movedFrom: null });
    expect(moscowTime(next!.startsAt)).toBe("17:00");

    // Moved again, it still came from its first time; back there, it is not moved.
    await teacher.teacher.schedule.move({ lessonId: lesson.id, date: addDays(first, 2), time: "09:00" });
    expect((await lessonsOn(addDays(first, 2), studentId)).find((l) => l.id === lesson.id)).toMatchObject({
      movedFrom: lesson.startsAt,
    });
    await teacher.teacher.schedule.move({ lessonId: lesson.id, date: first, time: "17:00" });
    expect((await lessonsOn(first, studentId)).find((l) => l.id === lesson.id)).toMatchObject({
      startsAt: lesson.startsAt,
      movedFrom: null,
    });
  });

  it("refuses a marked lesson and another teacher's", async () => {
    const studentId = await student("Отмеченный перенос");
    const lessonId = await lessonOn(studentId, moscow(-1));
    await expect(otherTeacher.teacher.schedule.move({ lessonId, date: moscow(1), time: "10:00" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await teacher.teacher.schedule.mark({ lessonId, status: "held", charged: true, unit: "", note: "" });
    await expect(teacher.teacher.schedule.move({ lessonId, date: moscow(1), time: "10:00" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("a lesson moved ahead and the history", () => {
  it("cannot be marked while it is in the future", async () => {
    const studentId = await student("Перенос вперёд");
    const lessonId = await lessonOn(studentId, moscow(-1));
    await teacher.teacher.schedule.move({ lessonId, date: moscow(2), time: "10:00" });
    await expect(
      teacher.teacher.schedule.mark({ lessonId, status: "held", charged: true, unit: "", note: "" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await teacher.teacher.schedule.history({ studentId })).toEqual([]);
  });

  it("tells in the history where a moved lesson came from, and that a cancelled one is cancelled", async () => {
    const studentId = await student("История переноса");
    const lessonId = await lessonOn(studentId, moscow(-3));
    const before = (await lessonsInWeekOf(moscow(-3), studentId))[0]!.startsAt;
    await teacher.teacher.schedule.move({ lessonId, date: moscow(-1), time: "12:00" });
    expect(await teacher.teacher.schedule.history({ studentId })).toEqual([
      expect.objectContaining({ id: lessonId, movedFrom: before, status: "scheduled" }),
    ]);
    await teacher.teacher.schedule.cancel({ lessonId, charged: true });
    expect((await teacher.teacher.schedule.history({ studentId }))[0]).toMatchObject({
      movedFrom: before,
      status: "cancelled",
      charged: true,
    });
  });
});

describe("cancelling a lesson", () => {
  it("keeps it on the week as cancelled, charged as chosen, and can put it back", async () => {
    const studentId = await student("Отмена");
    const date = moscow(3);
    const lessonId = await lessonOn(studentId, date);

    await teacher.teacher.schedule.cancel({ lessonId, charged: false });
    expect((await lessonsInWeekOf(date, studentId))[0]).toMatchObject({ status: "cancelled", charged: false, needsMark: false });
    await teacher.teacher.schedule.cancel({ lessonId, charged: true });
    expect((await lessonsInWeekOf(date, studentId))[0]).toMatchObject({ status: "cancelled", charged: true });

    await teacher.teacher.schedule.restore({ lessonId });
    expect((await lessonsInWeekOf(date, studentId))[0]).toMatchObject({ status: "scheduled", charged: null });
  });

  it("charges a cancellation with «Списать» in the balance, and never an introductory lesson", async () => {
    const studentId = await student("Списанная отмена");
    await teacher.teacher.payments.saveTerms({ studentId, format: "prepaid", price: "1000", currency: "RUB", validFrom: moscow(-7) });
    await teacher.teacher.payments.addPayment({ studentId, amount: "3000", paidOn: moscow(-7), comment: "" });
    await teacher.teacher.schedule.cancel({ lessonId: await lessonOn(studentId, moscow(2)), charged: true });
    const intro = (
      await teacher.teacher.schedule.addLesson({ studentId, date: moscow(4), time: "10:00", durationMinutes: 60, intro: true })
    ).id;
    await teacher.teacher.schedule.cancel({ lessonId: intro, charged: true });

    expect((await teacher.teacher.payments.get({ studentId })).balance).toMatch(/^Осталось 2 урока/);
    expect((await lessonsInWeekOf(moscow(4), studentId)).find((l) => l.id === intro)).toMatchObject({ charged: false });
  });

  it("refuses a marked lesson and another teacher's", async () => {
    const studentId = await student("Отмена отмеченного");
    const lessonId = await lessonOn(studentId, moscow(-1));
    await expect(otherTeacher.teacher.schedule.cancel({ lessonId, charged: false })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await teacher.teacher.schedule.mark({ lessonId, status: "missed", charged: false, unit: "", note: "" });
    await expect(teacher.teacher.schedule.cancel({ lessonId, charged: false })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(teacher.teacher.schedule.restore({ lessonId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("overlaps", () => {
  it("name who has a lesson at that time, but not the lesson itself, a cancelled one or one just before", async () => {
    const busy = await student("Занятый");
    const other = await student("Другой");
    const date = moscow(5);
    const busyLesson = await lessonOn(busy, date, "17:00");
    const at = { studentId: other, date, durationMinutes: 60 as const };

    expect(await teacher.teacher.schedule.overlaps({ ...at, time: "17:30" })).toEqual({ names: ["Занятый"] });
    expect(await teacher.teacher.schedule.overlaps({ ...at, time: "16:30" })).toEqual({ names: ["Занятый"] });
    // Ends when the other starts, or starts when it ends: no overlap.
    expect(await teacher.teacher.schedule.overlaps({ ...at, time: "16:00" })).toEqual({ names: [] });
    expect(await teacher.teacher.schedule.overlaps({ ...at, time: "18:00" })).toEqual({ names: [] });
    expect(
      await teacher.teacher.schedule.overlaps({ studentId: busy, date, time: "17:00", durationMinutes: 60, exceptLessonId: busyLesson }),
    ).toEqual({ names: [] });

    await teacher.teacher.schedule.cancel({ lessonId: busyLesson, charged: false });
    expect(await teacher.teacher.schedule.overlaps({ ...at, time: "17:30" })).toEqual({ names: [] });
  });

  it("never take another teacher's student", async () => {
    const studentId = await student("Чужое время");
    const date = moscow(6);
    await lessonOn(studentId, date, "12:00");
    await expect(
      otherTeacher.teacher.schedule.overlaps({ studentId, date, time: "12:00", durationMinutes: 60 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("the meeting link", () => {
  it("belongs to one lesson, is cleared by a blank, and takes web addresses only", async () => {
    const studentId = await student("Встреча");
    const date = moscow(2);
    const lessonId = await lessonOn(studentId, date, "10:00");
    const nextId = await lessonOn(studentId, date, "15:00");
    const link = "https://meet.example.test/abc-defg-hij";

    await teacher.teacher.schedule.setMeetingLink({ lessonId, link: ` ${link} ` });
    const lessons = await lessonsInWeekOf(date, studentId);
    expect(lessons.find((l) => l.id === lessonId)).toMatchObject({ meetingLink: link });
    expect(lessons.find((l) => l.id === nextId)).toMatchObject({ meetingLink: null });

    await expect(teacher.teacher.schedule.setMeetingLink({ lessonId, link: "javascript:alert(1)" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(otherTeacher.teacher.schedule.setMeetingLink({ lessonId, link })).rejects.toMatchObject({ code: "NOT_FOUND" });

    await teacher.teacher.schedule.setMeetingLink({ lessonId, link: "" });
    expect((await lessonsInWeekOf(date, studentId)).find((l) => l.id === lessonId)).toMatchObject({ meetingLink: null });
  });
});

describe("changing a slot from a date", () => {
  it("moves the lessons from that date; earlier ones and one moved by hand stay", async () => {
    const studentId = await student("Новое время");
    const first = moscow(2);
    const second = addDays(first, 7);
    const day = weekdayOf(first);
    await teacher.teacher.schedule.addSlot({ studentId, weekday: day, startTime: "17:00", durationMinutes: 60 });
    const [slot] = await teacher.teacher.schedule.slots({ studentId });
    const [moved] = await lessonsOn(second, studentId);
    await teacher.teacher.schedule.move({ lessonId: moved!.id, date: addDays(second, 2), time: "12:00" });

    await teacher.teacher.schedule.changeSlot({ slotId: slot!.id, weekday: day, startTime: "19:00", durationMinutes: 60, from: second });

    expect(moscowTime((await lessonsOn(first, studentId))[0]!.startsAt)).toBe("17:00");
    expect(await lessonsOn(second, studentId)).toEqual([]);
    expect((await lessonsOn(addDays(second, 2), studentId)).map((l) => [l.id, moscowTime(l.startsAt)])).toEqual([
      [moved!.id, "12:00"],
    ]);
    for (const week of [2, 3]) {
      const later = await lessonsOn(addDays(first, week * 7), studentId);
      expect(later.map((l) => moscowTime(l.startsAt))).toEqual(["19:00"]);
    }
    // The card shows the old slot until the day before and the new one from the date.
    expect(await teacher.teacher.schedule.slots({ studentId })).toEqual([
      expect.objectContaining({ startTime: "17:00", validUntil: addDays(second, -1) }),
      expect.objectContaining({ startTime: "19:00", validFrom: second, validUntil: null }),
    ]);
  });

  it("counts a lesson moved by hand for the new day's week too", async () => {
    const studentId = await student("Новый день");
    const first = moscow(2);
    const second = addDays(first, 7);
    await teacher.teacher.schedule.addSlot({ studentId, weekday: weekdayOf(first), startTime: "17:00", durationMinutes: 60 });
    const [slot] = await teacher.teacher.schedule.slots({ studentId });
    const [moved] = await lessonsOn(second, studentId);
    await teacher.teacher.schedule.move({ lessonId: moved!.id, date: second, time: "11:00" });

    // The slot moves to the next weekday from the second week: that week keeps only the lesson moved by hand.
    const newDay = weekdayOf(addDays(first, 1));
    await teacher.teacher.schedule.changeSlot({ slotId: slot!.id, weekday: newDay, startTime: "17:00", durationMinutes: 60, from: second });
    expect((await lessonsInWeekOf(second, studentId)).map((l) => l.id)).toEqual([moved!.id]);
    expect((await lessonsInWeekOf(addDays(second, 7), studentId)).map((l) => weekdayOf(dateIn(new Date(l.startsAt), "Europe/Moscow")))).toEqual([
      newDay,
    ]);
  });

  it("refuses a date before the student's today, a slot already changed, and another teacher's slot", async () => {
    const studentId = await student("Старый слот");
    await teacher.teacher.schedule.addSlot({ studentId, weekday: 1, startTime: "17:00", durationMinutes: 60 });
    const [slot] = await teacher.teacher.schedule.slots({ studentId });
    const change = { slotId: slot!.id, weekday: 1, startTime: "18:00", durationMinutes: 60 as const };

    await expect(teacher.teacher.schedule.changeSlot({ ...change, from: moscow(-1) })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(otherTeacher.teacher.schedule.changeSlot({ ...change, from: moscow(1) })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await teacher.teacher.schedule.changeSlot({ ...change, from: moscow(1) });
    await expect(teacher.teacher.schedule.changeSlot({ ...change, from: moscow(2) })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
