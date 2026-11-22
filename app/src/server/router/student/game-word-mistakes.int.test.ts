import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayIn } from "../../../domain/homework";
import { addDays } from "../../../domain/word-training";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { closeDb, db } from "../../db/client";
import { lesson, teacher as teacherTable, vocabularyWord } from "../../db/schema";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest } from "../index";

// A word missed in a game template comes back in the training (#285): a
// version 2 result naming a word of the student's vocabulary, wrong, makes
// it due tomorrow from the start and counts a mistake — by the student's
// link, on the teacher's page in a lesson and on the stage. A right answer,
// a word not in the vocabulary, a game without the mark, and version 1 move
// nothing. The words and games are synthetic.

const [teacherA] = seedTeachers as [(typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;
let teacherId: string;

const MOSCOW = "Europe/Moscow";
const html = (title: string) => `<!doctype html><html><body><h1>${title}</h1></body></html>`;
const tags = (title: string) => ({ title, level: "A2" as const, topic: "", ageGroup: "younger" as const });
const result = (version: 1 | 2, answers: object[]) => ({ type: "studysoft.game-result", version, answers });
const missed = (word: string) => ({ task: `${word}?`, answer: "x", correct: false, word });
const right = (word: string) => ({ task: `${word}?`, answer: "x", correct: true, word });

async function studentWithWords(firstName: string) {
  const { id: studentId } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: MOSCOW });
  for (const [word, translation] of [["owl", "сова"], ["fox", "лиса"]]) await teacher.teacher.students.addWord({ studentId, word: word!, translation: translation!, example: "" });
  await db().update(vocabularyWord).set({ trainStep: 3, dueOn: addDays(todayIn(MOSCOW), 8), trainedAt: new Date(), rightCount: 3 }).where(eq(vocabularyWord.studentId, studentId));
  const [row] = await db().insert(lesson).values({ teacherId, studentId, startsAt: new Date(Date.now() - 10 * 60_000), durationMinutes: 60, status: "scheduled" }).returning({ id: lesson.id });
  return { studentId, lessonId: row!.id };
}

async function state(studentId: string, word: string) {
  const [row] = await db()
    .select({ step: vocabularyWord.trainStep, dueOn: vocabularyWord.dueOn, wrong: vocabularyWord.wrongCount })
    .from(vocabularyWord)
    .where(and(eq(vocabularyWord.studentId, studentId), eq(vocabularyWord.word, word)));
  return row;
}

const back = { step: 0, dueOn: () => addDays(todayIn(MOSCOW), 1), wrong: 1 };

async function studentCaller(studentId: string) {
  const { url } = await teacher.teacher.links.student({ studentId });
  const response = await handleRouterRequest(
    new Request(`${env().APP_URL}/api/trpc/links.exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: url.split("#")[1]! }) }),
  );
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES.student}=`))!.split(";")[0]!;
  return createServerCaller(new Headers({ cookie }));
}

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  const [row] = await db().select({ id: teacherTable.id }).from(teacherTable).where(eq(teacherTable.email, teacherA.email));
  teacherId = row!.id;
});

afterAll(closeDb);

describe("a word missed in a game template", () => {
  it("comes back from the student's link; a right word, a word not in the vocabulary and a plain game move nothing", async () => {
    const { studentId } = await studentWithWords("Игры ошибки ссылка");
    const template = (await teacher.teacher.library.addGame({ ...tags("Шаблон ошибок"), html: html("x"), vocabulary: true })).id;
    const plain = (await teacher.teacher.library.addGame({ ...tags("Обычная ошибок"), html: html("x") })).id;
    for (const id of [template, plain]) await teacher.teacher.library.openToStudent({ id, studentId });
    const pupil = await studentCaller(studentId);

    await pupil.student.games.saveResult({ id: plain, result: result(2, [missed("owl")]) });
    expect((await state(studentId, "owl"))!.wrong).toBe(0);

    await pupil.student.games.saveResult({ id: template, result: result(2, [missed("OWL"), right("fox"), missed("ghost")]) });
    expect(await state(studentId, "owl")).toEqual({ step: back.step, dueOn: back.dueOn(), wrong: back.wrong });
    expect(await state(studentId, "fox")).toEqual({ step: 3, dueOn: addDays(todayIn(MOSCOW), 8), wrong: 0 });

    // Version 1 is still kept, and moves nothing.
    await pupil.student.games.saveResult({ id: template, result: result(1, [{ task: "fox?", answer: "x", correct: false }]) });
    expect((await state(studentId, "fox"))!.wrong).toBe(0);
  });

  it("comes back from the teacher's page in a lesson and from the stage", async () => {
    const page = await studentWithWords("Игры ошибки страница");
    const stage = await studentWithWords("Игры ошибки сцена");
    const template = (await teacher.teacher.library.addGame({ ...tags("Шаблон урока ошибок"), html: html("x"), vocabulary: true })).id;
    await teacher.teacher.library.saveLessonResult({ id: template, studentId: page.studentId, result: result(2, [missed("fox")]) });
    expect(await state(page.studentId, "fox")).toEqual({ step: back.step, dueOn: back.dueOn(), wrong: back.wrong });
    await teacher.teacher.lessonMode.saveGameResult({ lessonId: stage.lessonId, materialId: template, result: result(2, [missed("owl")]) });
    expect(await state(stage.studentId, "owl")).toEqual({ step: back.step, dueOn: back.dueOn(), wrong: back.wrong });
  });
});
