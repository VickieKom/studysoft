import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, dateIn } from "../../../domain/schedule";
import { closeDb, db } from "../../db/client";
import { homework, student } from "../../db/schema";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller } from "../index";

// «Главная» (#257): what needs the teacher — a fall of 10 points or more in a
// skill, a homework not submitted, prepaid lessons running out — the
// students with their numbers, and the lessons ahead. The teacher's own
// students only. The data is synthetic.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;
let other: ReturnType<typeof createServerCaller>;

const moscow = (days: number) => addDays(dateIn(new Date(), "Europe/Moscow"), days);
const doc = { version: 1, title: "x", tasks: [{ type: "written", prompt: "x" }] };

async function newStudent(firstName: string) {
  return (await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" })).id;
}

async function teacherOf(studentId: string) {
  const [row] = await db().select({ teacherId: student.teacherId }).from(student).where(eq(student.id, studentId));
  return row!.teacherId;
}

async function giveHomework(studentId: string, status: string, dueDate: string | null, publishedAt: Date) {
  await db()
    .insert(homework)
    .values({ teacherId: await teacherOf(studentId), studentId, title: `Домашка ${status}`, document: doc, status, dueDate, publishedAt });
}

async function overviewOf(studentId: string) {
  const found = (await teacher.teacher.home.get()).students.find((s) => s.id === studentId);
  if (!found) throw new Error("the student is not on «Главная»");
  return found;
}

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  other = createServerCaller(await signedInHeaders(teacherB));
});

afterAll(closeDb);

describe("«Главная»", () => {
  it("counts a fall of 10 points or more as a slip and shows every trend", async () => {
    const studentId = await newStudent("Главная просадка");
    await teacher.teacher.progress.save({ studentId, date: "2026-10-15", previousDate: null, results: { reading: 70, grammar: 60, writing: 40 } });
    await teacher.teacher.progress.save({ studentId, date: "2026-11-15", previousDate: null, results: { reading: 60, grammar: 55, writing: 60 } });
    expect(await overviewOf(studentId)).toMatchObject({
      trends: [
        { skill: "reading", trend: -10 },
        { skill: "grammar", trend: -5 },
        { skill: "writing", trend: 20 },
      ],
      slips: [{ skill: "reading", trend: -10 }],
      homeworkNotSubmitted: false,
      runningOut: null,
    });
  });

  it("names a homework not submitted: the latest missed, or published past its due date", async () => {
    const missed = await newStudent("Главная не сдана");
    await giveHomework(missed, "submitted", moscow(-10), new Date(Date.now() - 12 * 86_400_000));
    await giveHomework(missed, "missed", moscow(-3), new Date(Date.now() - 5 * 86_400_000));
    expect(await overviewOf(missed)).toMatchObject({ homeworkNotSubmitted: true, homework: { submitted: 1, due: 2 } });

    const late = await newStudent("Главная просрочена");
    await giveHomework(late, "published", moscow(-1), new Date(Date.now() - 3 * 86_400_000));
    expect((await overviewOf(late)).homeworkNotSubmitted).toBe(true);

    const onTime = await newStudent("Главная в срок");
    await giveHomework(onTime, "missed", moscow(-8), new Date(Date.now() - 10 * 86_400_000));
    await giveHomework(onTime, "published", moscow(2), new Date(Date.now() - 86_400_000));
    expect((await overviewOf(onTime)).homeworkNotSubmitted).toBe(false);

    const done = await newStudent("Главная сдана");
    await giveHomework(done, "missed", moscow(-8), new Date(Date.now() - 10 * 86_400_000));
    await giveHomework(done, "submitted", moscow(-1), new Date(Date.now() - 3 * 86_400_000));
    expect((await overviewOf(done)).homeworkNotSubmitted).toBe(false);
  });

  it("warns when prepaid lessons run out, at one lesson left, as the card does", async () => {
    const studentId = await newStudent("Главная предоплата");
    await teacher.teacher.payments.saveTerms({ studentId, format: "prepaid", price: "1500", currency: "RUB", validFrom: moscow(-7) });
    await teacher.teacher.payments.addPayment({ studentId, amount: "3000", paidOn: moscow(0), comment: "" });
    expect((await overviewOf(studentId)).runningOut).toBeNull();
    const { id: lessonId } = await teacher.teacher.schedule.addLesson({ studentId, date: moscow(-1), time: "00:01", durationMinutes: 60, intro: false });
    await teacher.teacher.schedule.mark({ lessonId, status: "held", charged: true, unit: "", note: "" });
    expect((await overviewOf(studentId)).runningOut?.replace(/\s/g, " ")).toBe("Осталось 1 урок · 1 500 ₽");
  });

  it("lists the lessons ahead with the student's time zone and homework, and leaves out a finished student", async () => {
    const studentId = await newStudent("Главная урок");
    await giveHomework(studentId, "submitted", moscow(-1), new Date(Date.now() - 86_400_000));
    const { id: lessonId } = await teacher.teacher.schedule.addLesson({ studentId, date: moscow(1), time: "10:00", durationMinutes: 60, intro: false });
    const home = await teacher.teacher.home.get();
    expect(home.lessons.find((l) => l.id === lessonId)).toMatchObject({
      studentId,
      firstName: "Главная урок",
      studentTimeZone: "Europe/Moscow",
      homework: "submitted",
      book: null,
      prepared: false,
    });
    expect(home.timeZone).toBe((await teacher.teacher.settings.get()).timeZone);

    await db().update(student).set({ status: "finished" }).where(eq(student.id, studentId));
    expect((await teacher.teacher.home.get()).students.some((s) => s.id === studentId)).toBe(false);
  });

  it("is the teacher's own: another teacher sees none of her students or lessons", async () => {
    const studentId = await newStudent("Главная чужая");
    const { id: lessonId } = await teacher.teacher.schedule.addLesson({ studentId, date: moscow(2), time: "11:00", durationMinutes: 60, intro: false });
    const theirs = await other.teacher.home.get();
    expect(theirs.students.some((s) => s.id === studentId)).toBe(false);
    expect(theirs.lessons.some((l) => l.id === lessonId)).toBe(false);
    await expect(createServerCaller(new Headers()).teacher.home.get()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
