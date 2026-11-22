import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "../../db/client";
import { gameResult, lesson, libraryMaterial } from "../../db/schema";
import { saveGameResult, saveLessonGameResult } from "../../library/game-results";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller } from "../index";

// Results of a game the teacher runs herself during a lesson (#147): kept
// for the student of a lesson going on now, marked as played with the
// teacher, and joined with the student's other mistakes. The games are
// synthetic HTML written here; the lessons are inserted with the moments
// each test needs.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
const MINUTE = 60_000;
const MISSING = "00000000-0000-4000-8000-000000000000";

let teacher: ReturnType<typeof createServerCaller>;
let teacherId: string;
let otherTeacher: ReturnType<typeof createServerCaller>;
let otherTeacherId: string;
let assistant: ReturnType<typeof createServerCaller>;

const run = crypto.randomUUID().slice(0, 8);

const result = (task: string, topic: string) => ({
  type: "studysoft.game-result",
  version: 1,
  answers: [
    { task: "A right one", answer: "yes", correct: true, topic: "right" },
    { task, answer: "wrong", correct: false, topic },
  ],
});

async function addGame(title: string, as = teacher) {
  const html = `<!doctype html><html><body><h1>${title}</h1></body></html>`;
  return (await as.teacher.library.addGame({ title, level: "A2", topic: `lesson results ${run}`, ageGroup: "younger", html })).id;
}

async function newStudent(firstName: string) {
  return (await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" })).id;
}

async function addLesson(owner: string, studentId: string, startsAt: Date, minutes = 45, status = "scheduled") {
  const [row] = await db()
    .insert(lesson)
    .values({ teacherId: owner, studentId, startsAt, durationMinutes: minutes, status })
    .returning({ id: lesson.id });
  return row!.id;
}

const kept = (studentId: string) =>
  db().select({ lessonId: gameResult.lessonId, withTeacher: gameResult.playedWithTeacher }).from(gameResult).where(eq(gameResult.studentId, studentId));

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  teacherId = (await teacher.teacher.session.me()).id;
  otherTeacher = createServerCaller(await signedInHeaders(teacherB));
  otherTeacherId = (await otherTeacher.teacher.session.me()).id;
  const { token } = await teacher.teacher.assistant.createToken();
  assistant = createServerCaller(new Headers({ authorization: `Bearer ${token}` }));
});

afterAll(closeDb);

describe("results of a game the teacher runs during a lesson", () => {
  it("keeps the result for the student of the lesson going on, marked as played with the teacher", async () => {
    const game = await addGame("Lesson game");
    const studentId = await newStudent("Урочная игра");
    const lessonId = await addLesson(teacherId, studentId, new Date(Date.now() - 10 * MINUTE));

    expect(await teacher.teacher.library.saveLessonResult({ id: game, studentId, result: result("Which one can fly?", "animals") })).toEqual({
      kept: true,
    });
    expect(await kept(studentId)).toEqual([{ lessonId, withTeacher: true }]);

    const [animals] = await teacher.teacher.students.mistakes({ studentId });
    expect(animals).toMatchObject({ topic: "animals", count: 1, mistakes: [{ from: "lesson_game", title: "Lesson game", task: "Which one can fly?" }] });
    const context = await assistant.agent.studentContext({ studentId });
    expect(context.mistakesByTopic).toEqual([{ topic: "animals", count: 1 }]);
    expect(context.recentGames.map((g) => [g.title, g.playedWithTeacher])).toEqual([["Lesson game", true]]);
  });

  it("refuses without a lesson going on: before, after, cancelled or missed; and keeps nothing", async () => {
    const game = await addGame("No lesson game");
    const studentId = await newStudent("Без урока сейчас");
    const now = Date.now();
    await addLesson(teacherId, studentId, new Date(now + MINUTE));
    await addLesson(teacherId, studentId, new Date(now - 46 * MINUTE), 45);
    await addLesson(teacherId, studentId, new Date(now - 10 * MINUTE), 45, "cancelled");
    await addLesson(teacherId, studentId, new Date(now - 10 * MINUTE), 45, "missed");

    await expect(teacher.teacher.library.saveLessonResult({ id: game, studentId, result: result("Task", "t") })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("урок"),
    });
    expect(await kept(studentId)).toEqual([]);
  });

  it("keeps it until the lesson's very end, and not at it", async () => {
    const game = await addGame("Boundary game");
    const studentId = await newStudent("Граница урока");
    const startsAt = new Date(Date.now() - 20 * MINUTE);
    await addLesson(teacherId, studentId, startsAt, 45);
    const end = new Date(startsAt.getTime() + 45 * MINUTE);
    const answers = result("Task", "t").answers as never;
    expect(await saveLessonGameResult(db(), teacherId, game, studentId, answers, new Date(end.getTime() - 1))).toBe(true);
    expect(await saveLessonGameResult(db(), teacherId, game, studentId, answers, end)).toBe(false);
    expect(await kept(studentId)).toHaveLength(1);
  });

  it("refuses another teacher's game or student, a missing game, a video and a message not in the format", async () => {
    const studentId = await newStudent("Чужие игры");
    await addLesson(teacherId, studentId, new Date(Date.now() - 10 * MINUTE));
    const ok = result("Task", "t");

    // Another teacher's game is the same as a missing one.
    const foreignGame = await addGame("Another teacher's game", otherTeacher);
    for (const id of [foreignGame, MISSING]) {
      await expect(teacher.teacher.library.saveLessonResult({ id, studentId, result: ok })).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    // Another teacher's student, even one in a lesson now with their own teacher.
    const game = await addGame("Own game");
    const [foreign] = await otherTeacher.teacher.students.list();
    const foreignLesson = await addLesson(otherTeacherId, foreign!.id, new Date(Date.now() - 5 * MINUTE));
    await expect(teacher.teacher.library.saveLessonResult({ id: game, studentId: foreign!.id, result: ok })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(await kept(foreign!.id)).toEqual([]);
    await db().delete(lesson).where(eq(lesson.id, foreignLesson));

    // A video is not a game.
    const video = await addGame("Video stand-in");
    await db().update(libraryMaterial).set({ kind: "video" }).where(eq(libraryMaterial.id, video));
    await expect(teacher.teacher.library.saveLessonResult({ id: video, studentId, result: ok })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Not in the format.
    await expect(
      teacher.teacher.library.saveLessonResult({ id: game, studentId, result: { ...ok, version: 3 } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await kept(studentId)).toEqual([]);
  });

  it("counts the latest result of a game in a lesson, whether the teacher or the student played it", async () => {
    const studentId = await newStudent("Оба способа");
    await addLesson(teacherId, studentId, new Date(Date.now() - 10 * MINUTE));
    const game = await addGame("Both ways");
    await teacher.teacher.library.saveLessonResult({ id: game, studentId, result: result("With the teacher", "first") });
    expect((await teacher.teacher.students.mistakes({ studentId })).map((t) => t.topic)).toEqual(["first"]);

    // Then the student plays it by their link in the same lesson: that result is the latest one.
    await teacher.teacher.library.openToStudent({ id: game, studentId });
    const later = new Date(Date.now() + 1000);
    expect(await saveGameResult(db(), teacherId, studentId, game, result("By the link", "second").answers as never, later)).toBe(true);
    await db().update(gameResult).set({ createdAt: later }).where(and(eq(gameResult.studentId, studentId), eq(gameResult.playedWithTeacher, false)));
    expect((await teacher.teacher.students.mistakes({ studentId })).map((t) => t.topic)).toEqual(["second"]);
    expect(await kept(studentId)).toHaveLength(2);
  });
});
