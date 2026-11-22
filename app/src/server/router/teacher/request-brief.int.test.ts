import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STARTING_BRIEF } from "../../../domain/brief";
import { closeDb, db } from "../../db/client";
import { clientRequestBrief, introBriefTemplate } from "../../db/schema";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller } from "../index";

// The intro's brief (#339): the teacher's template, the platform's starting
// set until she changes it; a brief on a request keeps the questions it was
// first saved with, so a later change of the template leaves it alone;
// «Удобное время» in the family's time zone; erased with the request.
// Answers are synthetic.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;
let other: ReturnType<typeof createServerCaller>;
let teacherId: string;

const today = new Date().toISOString().slice(0, 10);
const newRequest = async (firstName: string) =>
  (await teacher.teacher.requests.create({ firstName, age: 8, schoolYear: "", contact: "", source: "avito", requestedOn: today })).id;
const time = { timeZone: "Asia/Novosibirsk" as const, days: ["Вт" as const, "Чт" as const], ranges: [{ from: "16:00", to: "19:00" }] };

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  other = createServerCaller(await signedInHeaders(teacherB));
  teacherId = (await teacher.teacher.session.me()).id;
  // Each run starts from the platform's set.
  await db().delete(introBriefTemplate).where(eq(introBriefTemplate.teacherId, teacherId));
});

afterAll(closeDb);

describe("the brief's template", () => {
  it("is the platform's starting set until the teacher saves her own", async () => {
    expect(await teacher.teacher.requests.briefTemplate()).toEqual(STARTING_BRIEF);
    const own = [
      { ...STARTING_BRIEF[0]!, options: [...STARTING_BRIEF[0]!.options, "Подготовка к олимпиаде"] },
      { id: "own-1", key: null, text: "Как ребёнок относится к английскому?", options: [] },
    ];
    await teacher.teacher.requests.saveBriefTemplate({ questions: own });
    expect(await teacher.teacher.requests.briefTemplate()).toEqual(own);
    // Another teacher still has the starting set.
    expect(await other.teacher.requests.briefTemplate()).toEqual(STARTING_BRIEF);
    await expect(teacher.teacher.requests.saveBriefTemplate({ questions: [own[1]!, own[1]!] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("a request's brief", () => {
  it("shows the template before its first save, keeps its own questions after, and a later template change leaves it alone", async () => {
    const id = await newRequest("Брифовая");
    const before = await teacher.teacher.requests.brief({ id });
    expect(before).toMatchObject({ saved: false, answers: {}, convenientTime: { timeZone: expect.any(String), days: [], ranges: [] } });
    const questions = before.questions;
    expect(questions.map((q) => q.text)).toEqual(["Цели", "Как ребёнок относится к английскому?"]);

    const answers = { goals: { choices: ["Подготовка к олимпиаде", "Экзамен"], note: "Олимпиада в марте" }, "own-1": { choices: [], note: "Любит песни" } };
    await teacher.teacher.requests.saveBrief({ id, questions, answers, convenientTime: time });
    expect(await teacher.teacher.requests.brief({ id })).toEqual({ questions, answers, convenientTime: time, saved: true });

    // The template changes: the brief keeps its questions and answers.
    await teacher.teacher.requests.saveBriefTemplate({ questions: [{ id: "own-2", key: null, text: "Другой вопрос", options: [] }] });
    expect(await teacher.teacher.requests.brief({ id })).toEqual({ questions, answers, convenientTime: time, saved: true });
    // A later save sending the new template's questions changes nothing of them.
    await teacher.teacher.requests.saveBrief({ id, questions: await teacher.teacher.requests.briefTemplate(), answers, convenientTime: { ...time, days: ["Пн"] } });
    expect((await teacher.teacher.requests.brief({ id })).questions).toEqual(questions);
  });

  it("refuses an answer the brief has no question or choice for", async () => {
    const id = await newRequest("Неверный бриф");
    const { questions } = await teacher.teacher.requests.brief({ id });
    await expect(
      teacher.teacher.requests.saveBrief({ id, questions, answers: { "no-such": { choices: [], note: "" } }, convenientTime: time }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      teacher.teacher.requests.saveBrief({ id, questions, answers: { [questions[0]!.id]: { choices: ["Not an option"], note: "" } }, convenientTime: time }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      teacher.teacher.requests.saveBrief({ id, questions, answers: {}, convenientTime: { ...time, ranges: [{ from: "19:00", to: "16:00" }] } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await teacher.teacher.requests.brief({ id })).saved).toBe(false);
  });

  it("is another teacher's to no one, and goes with the request's personal data", async () => {
    const id = await newRequest("Стираемый бриф");
    const { questions } = await teacher.teacher.requests.brief({ id });
    await expect(other.teacher.requests.brief({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.teacher.requests.saveBrief({ id, questions, answers: {}, convenientTime: time })).rejects.toMatchObject({ code: "NOT_FOUND" });

    await teacher.teacher.requests.saveBrief({ id, questions, answers: {}, convenientTime: time });
    await teacher.teacher.requests.remove({ id });
    expect(await db().select({ id: clientRequestBrief.requestId }).from(clientRequestBrief).where(eq(clientRequestBrief.requestId, id))).toEqual([]);
    await expect(teacher.teacher.requests.brief({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
