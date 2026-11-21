import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, dateIn, mondayOf } from "../../../domain/schedule";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { closeDb, db } from "../../db/client";
import { lesson } from "../../db/schema";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest } from "../index";

// «Цель и показатель» (#266): the family's goal and a personal measure on the
// card, a number entered when a held lesson is marked, the last 30 days on
// the card oldest first. The teacher's only: another teacher gets not found;
// the student, the parent and the assistant get none of it. The data is
// synthetic.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;
let other: ReturnType<typeof createServerCaller>;

const moscow = (days: number) => addDays(dateIn(new Date(), "Europe/Moscow"), days);
const GOAL = "Говорить смелее на уроке";

async function newStudent(firstName: string) {
  return (await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" })).id;
}

async function heldLesson(studentId: string, days: number, measure: number | null, status: "held" | "missed" = "held") {
  const { id: lessonId } = await teacher.teacher.schedule.addLesson({ studentId, date: moscow(days), time: "00:01", durationMinutes: 60, intro: false });
  await teacher.teacher.schedule.mark({ lessonId, status, charged: false, unit: "", note: "", measure });
  return lessonId;
}

async function linkCaller(studentId: string, role: "student" | "parent") {
  const url = role === "student" ? (await teacher.teacher.links.student({ studentId })).url : (await teacher.teacher.links.parent({ studentId })).url;
  const response = await handleRouterRequest(
    new Request(`${env().APP_URL}/api/trpc/links.exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: url.split("#")[1]! }) }),
  );
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES[role]}=`))!.split(";")[0]!;
  return createServerCaller(new Headers({ cookie }));
}

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  other = createServerCaller(await signedInHeaders(teacherB));
});

afterAll(closeDb);

describe("«Цель и показатель»", () => {
  it("keeps the goal and the measure, trimmed; empty is none, and a unit without a name is dropped", async () => {
    const studentId = await newStudent("Цель хранится");
    expect(await teacher.teacher.goal.get({ studentId })).toEqual({ familyGoal: null, measureName: null, measureUnit: null, values: [] });
    await teacher.teacher.goal.save({ studentId, familyGoal: `  ${GOAL} `, measureName: " на английском ", measureUnit: "мин" });
    expect(await teacher.teacher.goal.get({ studentId })).toEqual({ familyGoal: GOAL, measureName: "на английском", measureUnit: "мин", values: [] });
    await teacher.teacher.goal.save({ studentId, familyGoal: " ", measureName: "", measureUnit: "мин" });
    expect(await teacher.teacher.goal.get({ studentId })).toEqual({ familyGoal: null, measureName: null, measureUnit: null, values: [] });
  });

  it("counts the numbers of held lessons of the last 30 days, oldest first; a missed lesson keeps none", async () => {
    const studentId = await newStudent("Показатель считается");
    await teacher.teacher.goal.save({ studentId, familyGoal: GOAL, measureName: "на английском", measureUnit: "мин" });
    await heldLesson(studentId, -40, 1);
    await heldLesson(studentId, -3, 5);
    const missed = await heldLesson(studentId, -2, 9, "missed");
    await heldLesson(studentId, -2, null);
    await heldLesson(studentId, -1, 12.5);
    expect((await teacher.teacher.goal.get({ studentId })).values).toEqual([5, 12.5]);
    const [row] = await db().select({ measure: lesson.measure }).from(lesson).where(eq(lesson.id, missed));
    expect(row!.measure).toBeNull();

    // The week shows the lesson's number and the student's measure.
    const mondays = [...new Set([mondayOf(moscow(-3)), mondayOf(moscow(-1))])];
    const lessons = (await Promise.all(mondays.map((monday) => teacher.teacher.schedule.week({ monday })))).flatMap((w) => w.lessons);
    const mine = lessons.filter((l) => l.studentId === studentId).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    expect(mine.map((l) => l.measure).sort()).toEqual([12.5, 5, null, null]);
    expect(mine[0]).toMatchObject({ measureName: "на английском", measureUnit: "мин" });

    for (const measure of [-1, 100_001]) {
      const { id: lessonId } = await teacher.teacher.schedule.addLesson({ studentId, date: moscow(-1), time: "03:00", durationMinutes: 60, intro: false });
      await expect(teacher.teacher.schedule.mark({ lessonId, status: "held", charged: false, unit: "", note: "", measure })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });

  it("is the teacher's only: another teacher gets not found; the student, the parent and the assistant get none of it", async () => {
    const studentId = await newStudent("Цель чужая");
    await teacher.teacher.goal.save({ studentId, familyGoal: GOAL, measureName: "на английском", measureUnit: "мин" });
    await heldLesson(studentId, -1, 7);
    await expect(other.teacher.goal.get({ studentId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.teacher.goal.save({ studentId, familyGoal: "x", measureName: "", measureUnit: "" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await teacher.teacher.goal.get({ studentId })).familyGoal).toBe(GOAL);

    const student = await linkCaller(studentId, "student");
    const parent = await linkCaller(studentId, "parent");
    const { token } = await teacher.teacher.assistant.createToken();
    const assistant = createServerCaller(new Headers({ authorization: `Bearer ${token}` }));
    const seen = JSON.stringify([
      await student.student.me(),
      await student.student.homework.current(),
      await parent.parent.me(),
      await parent.parent.progress(),
      await assistant.agent.studentContext({ studentId }),
    ]);
    for (const secret of [GOAL, "на английском"]) expect(seen).not.toContain(secret);
    await expect(student.teacher.goal.get({ studentId })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
