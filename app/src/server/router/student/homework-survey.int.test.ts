import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import short from "../../../../../deploy/seed/homework/demo-short.json";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { closeDb, db } from "../../db/client";
import { homeworkSurvey, lesson, lessonPlan } from "../../db/schema";
import { env } from "../../env";
import { surveyPeriod } from "../../homework/survey";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { appRouter, createServerCaller, handleRouterRequest } from "../index";

// The survey about the lessons (#332): gathered from the lessons held in its
// period — since the student's previous survey, at most two weeks; the first
// over a week — edited in the draft, opened with the homework, answered or
// skipped once, taken back with it, shown to the teacher only. The games and
// the homework are synthetic.

const [teacherA] = seedTeachers as [(typeof seedTeachers)[number]];
const DAY = 86_400_000;
let teacher: ReturnType<typeof createServerCaller>;
let teacherId: string;

const run = crypto.randomUUID().slice(0, 8);
const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

async function game(title: string, topic: string) {
  return (await teacher.teacher.library.addGame({ title, level: "A2", topic, ageGroup: "younger", html: "<!doctype html><title>g</title>" })).id;
}

/** A held lesson of the student `ago` ms back, its plan the given materials. */
async function held(studentId: string, ago: number, materials: string[]) {
  const [row] = await db()
    .insert(lesson)
    .values({ teacherId, studentId, startsAt: new Date(Date.now() - ago), durationMinutes: 45, status: "held" })
    .returning({ id: lesson.id });
  await db()
    .insert(lessonPlan)
    .values({ lessonId: row!.id, teacherId, plan: { stages: materials.map((materialId) => ({ type: "material", materialId, minutes: 10 })) } });
}

async function newStudent(firstName: string) {
  const { id } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  return id;
}

async function studentCaller(studentId: string, role: "student" | "parent" = "student") {
  const link = role === "student" ? (await teacher.teacher.links.student({ studentId })).url : (await teacher.teacher.links.parent({ studentId })).url;
  const response = await handleRouterRequest(
    new Request(`${env().APP_URL}/api/trpc/links.exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: link.split("#")[1]! }) }),
  );
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES[role]}=`))!.split(";")[0]!;
  return createServerCaller(new Headers({ cookie }));
}

const draft = async (studentId: string) => (await teacher.teacher.homework.import({ studentId, json: JSON.stringify(short) })).id;
const publish = async (id: string) =>
  teacher.teacher.homework.publish({ id, revision: (await teacher.teacher.homework.get({ id })).revision, dueDate: inDays(3) });
const texts = (survey: unknown) => (survey as { questions: { text: string }[] }).questions.map((q) => q.text);

let planets: string;
let pets: string;

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  teacherId = (await teacher.teacher.session.me()).id;
  planets = await game(`Planets ${run}`, "planets");
  pets = await game(`Pets ${run}`, "pets, Planets");
});

afterAll(closeDb);

describe("the survey in a draft", () => {
  it("gathers pairs of the lessons' materials, the topics, «Насколько понятно» per topic and «А ещё я хочу…»", async () => {
    const studentId = await newStudent("Опросный");
    await held(studentId, 2 * DAY, [planets]);
    await held(studentId, 1 * DAY, [pets, planets]);
    const id = await draft(studentId);
    expect(await teacher.teacher.homework.survey({ id })).toBeNull();
    const survey = await teacher.teacher.homework.setSurvey({ id, on: true });
    expect(texts(survey)).toEqual([
      `Что было веселее: Planets ${run} или Pets ${run}?`,
      "Про что хочется ещё? planets, pets",
      "Насколько понятно: planets?",
      "Насколько понятно: pets?",
      "А ещё я хочу…",
    ]);
    // Off removes it.
    expect(await teacher.teacher.homework.setSurvey({ id, on: false })).toBeNull();
    expect(await teacher.teacher.homework.survey({ id })).toBeNull();
  });

  it("says there were no lessons in the period, and gathers nothing", async () => {
    const studentId = await newStudent("Без уроков");
    // A lesson held before the period does not count.
    await held(studentId, 8 * DAY, [planets, pets]);
    const id = await draft(studentId);
    expect(await teacher.teacher.homework.setSurvey({ id, on: true })).toEqual({ noLessons: true });
    expect(await teacher.teacher.homework.survey({ id })).toBeNull();
  });

  it("takes «Убрать» and her own question on the questions the page showed, and refuses a stale page", async () => {
    const studentId = await newStudent("Правка опроса");
    await held(studentId, DAY, [planets, pets]);
    const id = await draft(studentId);
    const shown = (await teacher.teacher.homework.setSurvey({ id, on: true })) as { revision: string };
    const removed = await teacher.teacher.homework.editSurvey({ id, revision: shown.revision, edit: { remove: 3 } });
    expect(texts(removed)).not.toContain("Насколько понятно: pets?");
    // The first page, stale now, is refused.
    await expect(teacher.teacher.homework.editSurvey({ id, revision: shown.revision, edit: { add: "Stale?" } })).rejects.toMatchObject({ code: "CONFLICT" });
    const added = await teacher.teacher.homework.editSurvey({ id, revision: (removed as { revision: string }).revision, edit: { add: "Какую песню включить?" } });
    // Before «А ещё я хочу…», which stays last.
    expect(texts(added).slice(-2)).toEqual(["Какую песню включить?", "А ещё я хочу…"]);
  });
});

describe("the survey for the child", () => {
  it("opens with the homework, comes with its questions and choices, and is answered once; «Фидбэк» shows the answers", async () => {
    const studentId = await newStudent("Отвечающий");
    await held(studentId, DAY, [planets, pets]);
    const id = await draft(studentId);
    await teacher.teacher.homework.setSurvey({ id, on: true });
    const student = await studentCaller(studentId);
    expect(await student.student.homework.survey()).toBeNull();
    await publish(id);

    const survey = (await student.student.homework.survey())!;
    expect(survey.homeworkId).toBe(id);
    expect(survey.questions[0]).toEqual({ text: `Что было веселее: Planets ${run} или Pets ${run}?`, choices: [`Planets ${run}`, `Pets ${run}`, "Оба классные", "Оба так себе"], textAnswer: false });
    expect(survey.questions[2]!.choices).toEqual(["могу объяснить", "почти понял", "пока путаюсь"]);
    expect(survey.questions.at(-1)).toMatchObject({ text: "А ещё я хочу…", textAnswer: true });

    // An answer that is not one of a question's choices is refused.
    const invalid = survey.questions.map((_, i) => (i === 0 ? "Something else" : null));
    await expect(student.student.homework.answerSurvey({ homeworkId: id, answers: invalid })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // Partial answers are kept as they are.
    const answers = survey.questions.map((q, i) => (i === 0 ? `Planets ${run}` : i === 2 ? "почти понял" : q.textAnswer ? "  Больше игр  " : null));
    await student.student.homework.answerSurvey({ homeworkId: id, answers });
    expect(await student.student.homework.survey()).toBeNull();
    await expect(student.student.homework.answerSurvey({ homeworkId: id, answers: null })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const [feedback] = await teacher.teacher.students.surveyFeedback({ studentId });
    expect(feedback!.answers).toEqual([
      { question: `Что было веселее: Planets ${run} или Pets ${run}?`, answer: `Planets ${run}` },
      { question: "Насколько понятно: planets?", answer: "почти понял" },
      { question: "А ещё я хочу…", answer: "Больше игр" },
    ]);
  });

  it("is skipped with «Пропустить», leaving no answers", async () => {
    const studentId = await newStudent("Пропустил опрос");
    await held(studentId, DAY, [planets, pets]);
    const id = await draft(studentId);
    await teacher.teacher.homework.setSurvey({ id, on: true });
    await publish(id);
    const student = await studentCaller(studentId);
    await student.student.homework.answerSurvey({ homeworkId: id, answers: null });
    expect(await student.student.homework.survey()).toBeNull();
    expect(await teacher.teacher.students.surveyFeedback({ studentId })).toEqual([]);
  });

  it("goes back with a homework taken back before it is answered", async () => {
    const studentId = await newStudent("Снятый опрос");
    await held(studentId, DAY, [planets, pets]);
    const id = await draft(studentId);
    await teacher.teacher.homework.setSurvey({ id, on: true });
    await publish(id);
    const student = await studentCaller(studentId);
    expect(await student.student.homework.survey()).not.toBeNull();
    await teacher.teacher.homework.unpublish({ id });
    expect(await student.student.homework.survey()).toBeNull();
    await expect(student.student.homework.answerSurvey({ homeworkId: id, answers: null })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // It is the draft's again.
    expect(texts(await teacher.teacher.homework.survey({ id }))).toContain("А ещё я хочу…");
  });

  it("is never returned with its answers by a student or parent procedure", async () => {
    const procedures = Object.keys(appRouter._def.procedures).filter((p) => /^(student|parent)\./.test(p) && /survey/i.test(p));
    expect(procedures.sort()).toEqual(["student.homework.answerSurvey", "student.homework.survey"]);
    const studentId = await newStudent("Секретный опрос");
    await held(studentId, DAY, [planets, pets]);
    const id = await draft(studentId);
    await teacher.teacher.homework.setSurvey({ id, on: true });
    await publish(id);
    const student = await studentCaller(studentId);
    const survey = (await student.student.homework.survey())!;
    await student.student.homework.answerSurvey({ homeworkId: id, answers: survey.questions.map((q) => (q.textAnswer ? "Секретное желание" : null)) });
    const parent = await studentCaller(studentId, "parent");
    const outputs = JSON.stringify([await student.student.me(), await student.student.homework.current(), await parent.parent.me(), await parent.parent.progress(), await parent.parent.reports()]);
    expect(outputs).not.toContain("Секретное желание");
  });
});

describe("the survey's period", () => {
  it("is the last week for the first survey, runs from the previous one after it, and goes back two weeks at most", async () => {
    const studentId = await newStudent("Период опроса");
    const now = new Date();
    const first = await surveyPeriod(db(), teacherId, studentId, now);
    expect(Math.round((now.getTime() - first.from.getTime()) / DAY)).toBe(7);

    // A survey sent three days ago: the next one starts where it ended.
    const id = await draft(studentId);
    await db().insert(homeworkSurvey).values({ teacherId, studentId, homeworkId: id, periodFrom: new Date(now.getTime() - 10 * DAY), periodTo: new Date(now.getTime() - 3 * DAY), questions: [], status: "answered" });
    expect(Math.round((now.getTime() - (await surveyPeriod(db(), teacherId, studentId, now)).from.getTime()) / DAY)).toBe(3);

    // One sent a month ago: no further back than two weeks.
    await db().update(homeworkSurvey).set({ periodTo: new Date(now.getTime() - 30 * DAY) }).where(eq(homeworkSurvey.homeworkId, id));
    expect(Math.round((now.getTime() - (await surveyPeriod(db(), teacherId, studentId, now)).from.getTime()) / DAY)).toBe(14);

    // A draft's survey does not count.
    await db().update(homeworkSurvey).set({ status: "draft" }).where(eq(homeworkSurvey.homeworkId, id));
    expect(Math.round((now.getTime() - (await surveyPeriod(db(), teacherId, studentId, now)).from.getTime()) / DAY)).toBe(7);
  });
});
