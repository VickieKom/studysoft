import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import review from "../../../../../deploy/seed/homework/demo-review.json";
import { GAME_ACCESS_AFTER_LESSON_MS } from "../../../domain/library";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { MISTAKES_DAYS } from "../../crm/mistakes";
import { closeDb, db } from "../../db/client";
import { gameResult, homeworkSubmission, lesson } from "../../db/schema";
import { env } from "../../env";
import { countedGameResults, saveGameResult } from "../../library/game-results";
import { openGameToStudent } from "../../library/student-games";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest } from "../index";

// Game results and one list of a student's mistakes (#119): a result in the
// game result format is kept only from a game open to this student while
// the access lasts; the latest result per game and lesson counts; mistakes
// of homework and games make one list by topic over the last 30 days, on the
// card and in the assistant's context. The games and the homework are
// synthetic (deploy/seed/homework/demo-review.json).

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
const MINUTE = 60_000;
const DAY = 86_400_000;
const MISSING = "00000000-0000-4000-8000-000000000000";

let teacher: ReturnType<typeof createServerCaller>;
let teacherId: string;
let otherTeacher: ReturnType<typeof createServerCaller>;
let assistant: ReturnType<typeof createServerCaller>;

const run = crypto.randomUUID().slice(0, 8);
const json = (value: unknown) => JSON.stringify(value);
const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

/** A result in the format: one answer per entry, `[task, answer, correct, topic]`. */
const result = (...answers: [string, string, boolean, string?][]) => ({
  type: "studysoft.game-result",
  version: 1,
  answers: answers.map(([task, answer, correct, topic]) => ({ task, answer, correct, ...(topic ? { topic } : {}) })),
});

async function addGame(title: string, as = teacher) {
  const html = `<!doctype html><html><body><h1>${title}</h1></body></html>`;
  return (await as.teacher.library.addGame({ title, level: "A2", topic: `results ${run}`, ageGroup: "younger", html })).id;
}

/** A link session for a student of this teacher. */
async function sessionOf(studentId: string, as = teacher) {
  const token = (await as.teacher.links.student({ studentId })).url.split("#")[1]!;
  const response = await handleRouterRequest(
    new Request(`${env().APP_URL}/api/trpc/links.exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: json({ token }),
    }),
  );
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES.student}=`))!.split(";")[0]!;
  return { studentId, student: createServerCaller(new Headers({ cookie })) };
}

async function newStudent(firstName: string) {
  const { id } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  return sessionOf(id);
}

/** A lesson of the student starting at `startsAt`, `minutes` long. */
async function addLesson(studentId: string, startsAt: Date, minutes = 45) {
  const [row] = await db()
    .insert(lesson)
    .values({ teacherId, studentId, startsAt, durationMinutes: minutes, status: "scheduled" })
    .returning({ id: lesson.id });
  return row!.id;
}

/** A student in a lesson going on now with the game opened to them. */
async function playerWithGame(firstName: string, title: string) {
  const player = await newStudent(firstName);
  await addLesson(player.studentId, new Date(Date.now() - 10 * MINUTE));
  const game = await addGame(title);
  await teacher.teacher.library.openToStudent({ id: game, studentId: player.studentId });
  return { ...player, game };
}

/** Publishes the synthetic homework and submits it with the gap as given and only «cat» of the animals. */
async function submitHomework(studentId: string, student: ReturnType<typeof createServerCaller>, title: string, gap: string) {
  const { id } = await teacher.teacher.homework.import({ studentId, json: json({ ...review, title }) });
  const { revision } = await teacher.teacher.homework.get({ id });
  await teacher.teacher.homework.publish({ id, revision, dueDate: inDays(3) });
  await student.student.homework.saveAnswer({ id, taskIndex: 0, answer: { type: "single_choice", choice: 0 } });
  await student.student.homework.saveAnswer({ id, taskIndex: 1, answer: { type: "gap", gaps: [gap] } });
  await student.student.homework.saveAnswer({ id, taskIndex: 2, answer: { type: "multiple_choice", choices: [0] } });
  await student.student.homework.submit({ id, idempotencyKey: crypto.randomUUID() });
  return id;
}

const summary = (topics: { topic: string; count: number }[]) => Object.fromEntries(topics.map((t) => [t.topic, t.count]));
const kept = async (studentId: string) => db().select({ id: gameResult.id }).from(gameResult).where(eq(gameResult.studentId, studentId));

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  teacherId = (await teacher.teacher.session.me()).id;
  otherTeacher = createServerCaller(await signedInHeaders(teacherB));
  const { token } = await teacher.teacher.assistant.createToken();
  assistant = createServerCaller(new Headers({ authorization: `Bearer ${token}` }));
});

afterAll(closeDb);

describe("game results", () => {
  it("keeps a result in the format; its mistakes join the homework's on the card and in the context", async () => {
    const { studentId, student, game } = await playerWithGame("Итоговый", "Zoo quiz");
    expect(
      await student.student.games.saveResult({
        id: game,
        result: result(["Which one is a colour?", "red", true, "colours"], ["Which one is an animal?", "a table", false, "animals"], ["Say hello", "", false]),
      }),
    ).toEqual({ kept: true });
    await submitHomework(studentId, student, "Results: homework", "are");

    const card = await teacher.teacher.students.mistakes({ studentId });
    // animals: one from the game, one from the homework; to be from the homework; the blank game answer has no topic.
    expect(card.map((t) => [t.topic, t.count])).toEqual([
      ["animals", 2],
      ["to be", 1],
      ["Без темы", 1],
    ]);
    const animals = card[0]!.mistakes.map(({ from, title, task, answer }) => ({ from, title, task, answer }));
    expect(animals).toEqual([
      { from: "homework", title: "Results: homework", task: review.tasks[2]!.prompt, answer: "cat" },
      { from: "game", title: "Zoo quiz", task: "Which one is an animal?", answer: "a table" },
    ]);
    expect(card[2]!.mistakes[0]).toMatchObject({ from: "game", task: "Say hello", answer: null });

    const context = await assistant.agent.studentContext({ studentId });
    expect(summary(context.mistakesByTopic)).toEqual({ animals: 2, "to be": 1, "Без темы": 1 });
    expect(context.recentGames).toEqual([
      {
        title: "Zoo quiz",
        playedAt: expect.any(String),
        playedWithTeacher: false,
        answers: [
          { task: "Which one is a colour?", answer: "red", correct: true, topic: "colours" },
          { task: "Which one is an animal?", answer: "a table", correct: false, topic: "animals" },
          { task: "Say hello", answer: "", correct: false },
        ],
      },
    ]);
  });

  it("refuses a message not in the format and keeps nothing of it", async () => {
    const { studentId, student, game } = await playerWithGame("Неформатный", "Broken");
    const answer = { task: "A task", answer: "x", correct: false };
    const broken: unknown[] = [
      { type: "something-else", version: 1, answers: [answer] },
      { type: "studysoft.game-result", version: 3, answers: [answer] },
      { type: "studysoft.game-result", version: 1, answers: [] },
      { type: "studysoft.game-result", version: 1, answers: [{ ...answer, correct: "no" }] },
      { type: "studysoft.game-result", version: 1, answers: [{ correct: false, answer: "x" }] },
      { type: "studysoft.game-result", version: 1, answers: [{ ...answer, extra: "field" }] },
      { type: "studysoft.game-result", version: 1, answers: [{ ...answer, skill: "dancing" }] },
      { type: "studysoft.game-result", version: 1, answers: [{ ...answer, task: "x".repeat(501) }] },
      { type: "studysoft.game-result", version: 1, answers: Array.from({ length: 101 }, () => answer) },
      { type: "studysoft.game-result", version: 1, answers: [answer], score: 10 },
      "studysoft.game-result",
      null,
    ];
    for (const message of broken) {
      await expect(student.student.games.saveResult({ id: game, result: message })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(await kept(studentId)).toEqual([]);
    expect(await teacher.teacher.students.mistakes({ studentId })).toEqual([]);
  });

  it("refuses a result from a game not open to this student, a missing one and another teacher's", async () => {
    const { game } = await playerWithGame("Открытый", "Open to one");
    const ok = result(["Task", "answer", false, "topic"]);
    // A student of the same teacher in a lesson now, but the game was not opened to them.
    const neighbour = await newStudent("Соседский");
    await addLesson(neighbour.studentId, new Date(Date.now() - 10 * MINUTE));
    await expect(neighbour.student.student.games.saveResult({ id: game, result: ok })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(neighbour.student.student.games.saveResult({ id: MISSING, result: ok })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await kept(neighbour.studentId)).toEqual([]);

    // Another teacher's student: the game's id means nothing to them.
    const [foreign] = await otherTeacher.teacher.students.list();
    const stranger = await sessionOf(foreign!.id, otherTeacher);
    await expect(stranger.student.student.games.saveResult({ id: game, result: ok })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await kept(foreign!.id)).toEqual([]);
    // No session at all.
    await expect(createServerCaller(new Headers()).student.games.saveResult({ id: game, result: ok })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    // And another teacher cannot read the student's list.
    await expect(otherTeacher.teacher.students.mistakes({ studentId: neighbour.studentId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("keeps a result until exactly the end of the access, and not a moment longer", async () => {
    const game = await addGame("Ending");
    const { studentId, student } = await newStudent("Поздний");
    const startsAt = new Date(Date.now() - 20 * MINUTE);
    await addLesson(studentId, startsAt, 45);
    const until = (await openGameToStudent(db(), teacherId, game, studentId))!;
    expect(until).toEqual(new Date(startsAt.getTime() + 45 * MINUTE + GAME_ACCESS_AFTER_LESSON_MS));
    const answers = result(["Task", "answer", false, "late"]).answers;

    expect(await saveGameResult(db(), teacherId, studentId, game, answers, new Date(until.getTime() - 1))).toBe(true);
    expect(await saveGameResult(db(), teacherId, studentId, game, answers, until)).toBe(false);
    expect(await kept(studentId)).toHaveLength(1);

    // A game opened in a lesson long over: the procedure refuses it.
    const old = await addGame("Over");
    const lessonStart = new Date(Date.now() - 4 * 60 * MINUTE);
    await addLesson(studentId, lessonStart, 45);
    await openGameToStudent(db(), teacherId, old, studentId, new Date(lessonStart.getTime() + MINUTE));
    await expect(student.student.games.saveResult({ id: old, result: result(["Task", "a", false]) })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await kept(studentId)).toHaveLength(1);
  });

  it("counts the latest result of a game in a lesson, and a result of each lesson", async () => {
    const { studentId, student, game } = await playerWithGame("Повторяющий", "Played twice");
    await student.student.games.saveResult({ id: game, result: result(["First try", "x", false, "first"]) });
    await student.student.games.saveResult({ id: game, result: result(["Second try", "y", false, "second"]) });
    // Both are kept; only the latest counts.
    expect(await kept(studentId)).toHaveLength(2);
    expect(summary(await teacher.teacher.students.mistakes({ studentId }))).toEqual({ second: 1 });

    // A result of the same game in an earlier lesson counts on its own.
    const earlier = await addLesson(studentId, new Date(Date.now() - 3 * DAY));
    await db()
      .insert(gameResult)
      .values({
        teacherId,
        studentId,
        materialId: game,
        lessonId: earlier,
        title: "Played twice",
        answers: result(["Earlier lesson", "z", false, "earlier"]).answers,
        createdAt: new Date(Date.now() - 3 * DAY),
      });
    expect(summary(await teacher.teacher.students.mistakes({ studentId }))).toEqual({ second: 1, earlier: 1 });
    const counted = await countedGameResults(db(), teacherId, studentId, { since: new Date(Date.now() - DAY * MISTAKES_DAYS) });
    expect(counted.map((r) => r.answers[0]!.task)).toEqual(["Second try", "Earlier lesson"]);
  });

  it("covers the last 30 days, homework and games alike, and outlives a game deleted from the library", async () => {
    const { studentId, student, game } = await playerWithGame("Давний", "Deleted later");
    await student.student.games.saveResult({ id: game, result: result(["Recent game task", "x", false, "recent game"]) });
    const oldHomework = await submitHomework(studentId, student, "Old homework", "are");
    await submitHomework(studentId, student, "Recent homework", "is");
    // A month and a day ago: out of the list.
    const longAgo = new Date(Date.now() - (MISTAKES_DAYS + 1) * DAY);
    await db().update(homeworkSubmission).set({ submittedAt: longAgo }).where(eq(homeworkSubmission.homeworkId, oldHomework));
    const oldLesson = await addLesson(studentId, longAgo);
    await db()
      .insert(gameResult)
      .values({
        teacherId,
        studentId,
        materialId: game,
        lessonId: oldLesson,
        title: "Deleted later",
        answers: result(["Old game task", "x", false, "old game"]).answers,
        createdAt: longAgo,
      });

    const card = await teacher.teacher.students.mistakes({ studentId });
    // The recent homework has the gap right and only «cat» of the animals.
    expect(summary(card)).toEqual({ "recent game": 1, animals: 1 });
    expect(card.find((t) => t.topic === "animals")!.mistakes[0]!.title).toBe("Recent homework");
    const context = await assistant.agent.studentContext({ studentId });
    expect(summary(context.mistakesByTopic)).toEqual({ "recent game": 1, animals: 1 });
    // The latest game results are not cut at 30 days: only the summary is.
    expect(context.recentGames.map((g) => g.answers[0]!.task)).toEqual(["Recent game task", "Old game task"]);

    // The game is deleted from the library: its mistakes stay, with its title.
    await teacher.teacher.library.remove({ id: game });
    const after = await teacher.teacher.students.mistakes({ studentId });
    expect(after.find((t) => t.topic === "recent game")!.mistakes[0]).toMatchObject({ from: "game", title: "Deleted later" });
  });
});
