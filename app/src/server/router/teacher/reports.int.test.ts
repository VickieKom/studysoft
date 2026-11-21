import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_BLOCKS } from "../../../domain/report";
import { addDays, dateIn } from "../../../domain/schedule";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { closeDb, db } from "../../db/client";
import { homework, report, student, vocabularyWord } from "../../db/schema";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest } from "../index";

// A parent's report drafted on the card (#267): one draft per student, the
// first over the last 30 days and the next from the day after the last
// published one; the numbers of the period — skills, the personal measure,
// lessons, homework, words, the textbook; the teacher's blocks saved. The
// teacher's only. The data is synthetic.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;
let other: ReturnType<typeof createServerCaller>;

const moscow = (days: number) => addDays(dateIn(new Date(), "Europe/Moscow"), days);
const doc = { version: 1, title: "x", tasks: [{ type: "written", prompt: "x" }] };

async function newStudent(firstName: string) {
  const { id } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  const [row] = await db().select({ teacherId: student.teacherId }).from(student).where(eq(student.id, id));
  return { studentId: id, teacherId: row!.teacherId };
}

async function lessonOn(studentId: string, days: number, status: "held" | "missed" | "cancelled", measure: number | null = null) {
  const { id: lessonId } = await teacher.teacher.schedule.addLesson({ studentId, date: moscow(days), time: "12:00", durationMinutes: 60, intro: false });
  if (status === "cancelled") await teacher.teacher.schedule.cancel({ lessonId, charged: false });
  else await teacher.teacher.schedule.mark({ lessonId, status, charged: false, unit: "", note: "", measure });
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

describe("a report draft", () => {
  it("is one per student, over the last 30 days with the four blocks, and keeps what the teacher saves", async () => {
    const { studentId } = await newStudent("Отчёт один");
    const [first, second] = await Promise.all([teacher.teacher.reports.open({ studentId }), teacher.teacher.reports.open({ studentId })]);
    expect(second.id).toBe(first.id);
    expect(first).toMatchObject({ periodFrom: moscow(-30), periodTo: moscow(0), showPayments: false, balance: null });
    expect(first.blocks.map((b) => b.title)).toEqual([...DEFAULT_BLOCKS]);

    const blocks = [
      { title: "Что получается", text: "Читает вслух." },
      { title: "Олимпиада", text: "Школьный тур." },
    ];
    await teacher.teacher.reports.save({ reportId: first.id, blocks, showPayments: true });
    expect(await teacher.teacher.reports.open({ studentId })).toMatchObject({ id: first.id, blocks, showPayments: true });
    expect(await teacher.teacher.reports.list({ studentId })).toEqual([{ id: first.id, status: "draft", periodFrom: moscow(-30), periodTo: moscow(0) }]);

    for (const bad of [[{ title: " ", text: "x" }], Array.from({ length: 13 }, () => ({ title: "x", text: "" }))]) {
      await expect(teacher.teacher.reports.save({ reportId: first.id, blocks: bad, showPayments: false })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });

  it("counts the period's skills, measure, lessons, homework, words and nothing before it", async () => {
    const { studentId, teacherId } = await newStudent("Отчёт цифры");
    await teacher.teacher.goal.save({ studentId, familyGoal: "", measureName: "на английском", measureUnit: "мин" });
    await teacher.teacher.progress.save({ studentId, date: moscow(-40), previousDate: null, results: { reading: 60, grammar: 40 } });
    await teacher.teacher.progress.save({ studentId, date: moscow(-10), previousDate: null, results: { reading: 70 } });
    await lessonOn(studentId, -40, "held", 1);
    await lessonOn(studentId, -5, "held", 5);
    await lessonOn(studentId, -3, "missed");
    await lessonOn(studentId, -2, "cancelled");
    await lessonOn(studentId, -1, "held", 12);
    for (const [status, due] of [["submitted", moscow(-4)], ["missed", moscow(-6)], ["submitted", moscow(-45)]] as const) {
      await db().insert(homework).values({ teacherId, studentId, title: `Отчёт ${status}`, document: doc, status, dueDate: due });
    }
    for (const word of ["owl", "fox"]) await teacher.teacher.students.addWord({ studentId, word, translation: "x", example: "" });
    await db().update(vocabularyWord).set({ trainStep: 5 }).where(and(eq(vocabularyWord.studentId, studentId), eq(vocabularyWord.word, "owl")));
    await db().update(vocabularyWord).set({ createdAt: new Date(Date.now() - 60 * 86_400_000) }).where(and(eq(vocabularyWord.studentId, studentId), eq(vocabularyWord.word, "fox")));

    expect((await teacher.teacher.reports.open({ studentId })).numbers).toEqual({
      skills: [{ skill: "reading", percent: 70, trend: 10 }],
      measure: "на английском: 5 → 12 мин",
      lessons: { held: 2, missed: 1, cancelled: 1 },
      homework: { submitted: 1, due: 2 },
      words: { added: 1, learnt: 1, total: 2 },
      textbook: null,
    });
  });

  it("starts the next report the day after the last published one, and leaves a published one alone", async () => {
    const { studentId, teacherId } = await newStudent("Отчёт следующий");
    const blocks = [{ title: "План", text: "x" }];
    const [published] = await db()
      .insert(report)
      .values({ teacherId, studentId, periodFrom: moscow(-40), periodTo: moscow(-8), status: "published", blocks, publishedAt: new Date() })
      .returning({ id: report.id });
    const draft = await teacher.teacher.reports.open({ studentId });
    expect(draft).toMatchObject({ periodFrom: moscow(-7), periodTo: moscow(0) });
    expect(draft.id).not.toBe(published!.id);
    // A published report is edited in place and stays published (#268).
    await teacher.teacher.reports.save({ reportId: published!.id, blocks: [], showPayments: false });
    expect((await teacher.teacher.reports.list({ studentId })).map((r) => r.status)).toEqual(["draft", "published"]);
  });

  it("is the teacher's only: another teacher, the student and the parent get none of it", async () => {
    const { studentId } = await newStudent("Отчёт чужой");
    const draft = await teacher.teacher.reports.open({ studentId });
    await teacher.teacher.reports.save({ reportId: draft.id, blocks: [{ title: "Что получается", text: "Секретный текст отчёта" }], showPayments: false });
    await expect(other.teacher.reports.open({ studentId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.teacher.reports.list({ studentId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.teacher.reports.save({ reportId: draft.id, blocks: [], showPayments: false })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const parent = await linkCaller(studentId, "parent");
    const student = await linkCaller(studentId, "student");
    expect(JSON.stringify([await parent.parent.me(), await parent.parent.progress(), await student.student.me()])).not.toContain("Секретный текст отчёта");
    await expect(parent.teacher.reports.list({ studentId })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
