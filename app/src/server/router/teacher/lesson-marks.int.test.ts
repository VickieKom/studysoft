import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, dateIn } from "../../../domain/schedule";
import { closeDb } from "../../db/client";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller } from "../index";

// Marking lessons and the lesson history (#82).

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];

let teacher: ReturnType<typeof createServerCaller>;
let otherTeacher: ReturnType<typeof createServerCaller>;
const base = { lastName: "", level: "A2" as const, timeZone: "Europe/Moscow" as const };
const moscow = (days: number) => addDays(dateIn(new Date(), "Europe/Moscow"), days);

async function studentWithLesson(firstName: string, days: number, intro = false) {
  const { id: studentId } = await teacher.teacher.students.create({ ...base, firstName });
  const { id: lessonId } = await teacher.teacher.schedule.addLesson({
    studentId,
    date: moscow(days),
    time: "10:00",
    durationMinutes: 60,
    intro,
  });
  return { studentId, lessonId };
}

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  otherTeacher = createServerCaller(await signedInHeaders(teacherB));
});

afterAll(closeDb);

describe("lesson marks", () => {
  it("ask for an ended lesson to be marked, and keep the mark with the unit and the note", async () => {
    const { studentId, lessonId } = await studentWithLesson("Отметка", -1);
    expect(await teacher.teacher.schedule.history({ studentId })).toEqual([
      expect.objectContaining({ id: lessonId, status: "scheduled", needsMark: true, charged: null }),
    ]);

    await teacher.teacher.schedule.mark({ lessonId, status: "held", charged: true, unit: "Юнит 4", note: "Заметка" });
    expect(await teacher.teacher.schedule.history({ studentId })).toEqual([
      expect.objectContaining({ status: "held", charged: true, unit: "Юнит 4", note: "Заметка", needsMark: false }),
    ]);

    // Changed later, and blank text is none.
    await teacher.teacher.schedule.mark({ lessonId, status: "missed", charged: false, unit: " ", note: "" });
    expect(await teacher.teacher.schedule.history({ studentId })).toEqual([
      expect.objectContaining({ status: "missed", charged: false, unit: null, note: null }),
    ]);
  });

  it("never charge an introductory lesson", async () => {
    const { studentId, lessonId } = await studentWithLesson("Вводный", -2, true);
    await teacher.teacher.schedule.mark({ lessonId, status: "held", charged: true, unit: "", note: "" });
    expect((await teacher.teacher.schedule.history({ studentId }))[0]).toMatchObject({ status: "held", charged: false });
  });

  it("refuse a lesson that has not started, and leave future lessons out of the history", async () => {
    const { studentId, lessonId } = await studentWithLesson("Будущий", 3);
    await expect(
      teacher.teacher.schedule.mark({ lessonId, status: "held", charged: true, unit: "", note: "" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await teacher.teacher.schedule.history({ studentId })).toEqual([]);
  });

  it("show the mark on the week", async () => {
    const { lessonId } = await studentWithLesson("Неделя отметки", -1);
    await teacher.teacher.schedule.mark({ lessonId, status: "held", charged: true, unit: "", note: "" });
    const day = moscow(-1);
    const monday = addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
    const week = await teacher.teacher.schedule.week({ monday });
    expect(week.lessons.find((l) => l.id === lessonId)).toMatchObject({ status: "held", needsMark: false });
  });

  it("keep another teacher out", async () => {
    const { studentId, lessonId } = await studentWithLesson("Чужая отметка", -1);
    await expect(
      otherTeacher.teacher.schedule.mark({ lessonId, status: "held", charged: true, unit: "", note: "" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(otherTeacher.teacher.schedule.history({ studentId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
