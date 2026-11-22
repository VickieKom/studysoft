import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, dateIn } from "../../../domain/schedule";
import { closeDb, db } from "../../db/client";
import { lesson, student } from "../../db/schema";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller } from "../index";

// A renamed personal measure starts from zero (#279): another name or unit
// erases the numbers of the student's lessons; the same measure, or a
// change of the goal alone, keeps them. The comparison and the erasing hold
// the student's row, so a second save waits for the first. The data is
// synthetic.

const [teacherA] = seedTeachers as [(typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;

const moscow = (days: number) => addDays(dateIn(new Date(), "Europe/Moscow"), days);
const goal = (studentId: string, familyGoal: string, measureName: string, measureUnit: string) => teacher.teacher.goal.save({ studentId, familyGoal, measureName, measureUnit });

async function measured(firstName: string) {
  const { id: studentId } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  await goal(studentId, "Цель", "на английском", "мин");
  for (const [days, measure] of [[-3, 5], [-2, 12]] as const) {
    const { id: lessonId } = await teacher.teacher.schedule.addLesson({ studentId, date: moscow(days), time: "00:01", durationMinutes: 60, intro: false });
    await teacher.teacher.schedule.mark({ lessonId, status: "held", charged: false, unit: "", note: "", measure });
  }
  return studentId;
}

const numbers = async (studentId: string) =>
  (await db().select({ measure: lesson.measure }).from(lesson).where(eq(lesson.studentId, studentId))).map((r) => r.measure).sort();

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
});

afterAll(closeDb);

describe("a renamed personal measure", () => {
  it("keeps the numbers for the same measure and a new goal, and erases them for another name or unit", async () => {
    const studentId = await measured("Показатель сброс");
    await goal(studentId, "Другая цель", " на английском ", "мин");
    expect(await numbers(studentId)).toEqual([12, 5]);
    expect((await teacher.teacher.goal.get({ studentId })).values).toEqual([5, 12]);

    await goal(studentId, "Другая цель", "на английском", "минуты");
    expect(await numbers(studentId)).toEqual([null, null]);
    expect((await teacher.teacher.goal.get({ studentId })).values).toEqual([]);
  });

  it("erases them when the measure is removed", async () => {
    const studentId = await measured("Показатель убран");
    await goal(studentId, "Цель", "", "");
    expect(await numbers(studentId)).toEqual([null, null]);
  });

  it("holds the student's row: a save waits while another holds it", async () => {
    const studentId = await measured("Показатель очередь");
    let locked!: () => void;
    let release!: () => void;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    const holding = db().transaction(async (tx) => {
      await tx.select({ id: student.id }).from(student).where(eq(student.id, studentId)).for("update");
      locked();
      await released;
    });
    await isLocked;
    const saving = goal(studentId, "Цель", "книги", "шт.").then(() => "saved");
    expect(await Promise.race([saving, new Promise((resolve) => setTimeout(() => resolve("waiting"), 300))])).toBe("waiting");
    release();
    await holding;
    expect(await saving).toBe("saved");
    expect(await numbers(studentId)).toEqual([null, null]);
  });
});
