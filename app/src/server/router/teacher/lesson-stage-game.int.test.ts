import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "../../db/client";
import { gameResult, lesson } from "../../db/schema";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller } from "../index";

// A game on the lesson stage (#199): its result is kept for the stage's
// lesson and its student, as a game played with the teacher, whatever the
// clock says — the lesson only has to be still to hold (product owner,
// 2026-11-19). The games are synthetic HTML written here.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
const DAY = 86_400_000;

let teacher: ReturnType<typeof createServerCaller>;
let teacherId: string;
let other: ReturnType<typeof createServerCaller>;

const run = crypto.randomUUID().slice(0, 8);
const result = (topic: string) => ({
  type: "studysoft.game-result",
  version: 1,
  answers: [
    { task: "A right one", answer: "yes", correct: true, topic: "right" },
    { task: "A wrong one", answer: "no", correct: false, topic },
  ],
});

async function addGame(title: string, as = teacher) {
  const html = `<!doctype html><html><body><h1>${title}</h1></body></html>`;
  return (await as.teacher.library.addGame({ title, level: "A2", topic: `stage ${run}`, ageGroup: "younger", html })).id;
}

async function studentWithLesson(firstName: string, inDays = 1) {
  const { id: studentId } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  const [row] = await db()
    .insert(lesson)
    .values({ teacherId, studentId, startsAt: new Date(Date.now() + inDays * DAY), durationMinutes: 45 })
    .returning({ id: lesson.id });
  return { studentId, lessonId: row!.id };
}

async function codeOf(call: Promise<unknown>) {
  try {
    await call;
    return "OK";
  } catch (error) {
    return error instanceof TRPCError ? error.code : String(error);
  }
}

const kept = (studentId: string) =>
  db().select({ lessonId: gameResult.lessonId, withTeacher: gameResult.playedWithTeacher }).from(gameResult).where(eq(gameResult.studentId, studentId));

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  teacherId = (await teacher.teacher.session.me()).id;
  other = createServerCaller(await signedInHeaders(teacherB));
});

afterAll(closeDb);

describe("a game on the lesson stage", () => {
  it("keeps the result for the lesson's student, before the lesson's time too, as played with the teacher", async () => {
    const game = await addGame("Stage int game");
    const { studentId, lessonId } = await studentWithLesson("Игра на сцене");
    expect(await teacher.teacher.lessonMode.saveGameResult({ lessonId, materialId: game, result: result(`stage topic ${run}`) })).toEqual({
      kept: true,
    });
    expect(await kept(studentId)).toEqual([{ lessonId, withTeacher: true }]);

    // On the card, with the student's other mistakes, as a game of the lesson.
    const [topic] = await teacher.teacher.students.mistakes({ studentId });
    expect(topic).toMatchObject({ topic: `stage topic ${run}`, count: 1, mistakes: [{ from: "lesson_game", title: "Stage int game", answer: "no" }] });
  });

  it("keeps nothing for a lesson no longer to hold, a video, another teacher's game or lesson, or a message not in the format", async () => {
    const game = await addGame("Stage int refused");
    const { studentId, lessonId } = await studentWithLesson("Без итога на сцене");

    expect(await codeOf(teacher.teacher.lessonMode.saveGameResult({ lessonId, materialId: game, result: { type: "other" } }))).toBe("BAD_REQUEST");

    const { id: video } = await teacher.teacher.library.addVideoLink({
      title: `Stage video ${run}`,
      level: "A2",
      topic: "",
      ageGroup: "younger",
      url: "https://example.test/video",
    });
    expect(await codeOf(teacher.teacher.lessonMode.saveGameResult({ lessonId, materialId: video, result: result("x") }))).toBe("NOT_FOUND");

    const othersGame = await addGame("Another teacher's stage game", other);
    expect(await codeOf(teacher.teacher.lessonMode.saveGameResult({ lessonId, materialId: othersGame, result: result("x") }))).toBe("NOT_FOUND");
    expect(await codeOf(other.teacher.lessonMode.saveGameResult({ lessonId, materialId: othersGame, result: result("x") }))).toBe("NOT_FOUND");

    for (const status of ["held", "missed", "cancelled"]) {
      await db().update(lesson).set({ status }).where(eq(lesson.id, lessonId));
      expect(await codeOf(teacher.teacher.lessonMode.saveGameResult({ lessonId, materialId: game, result: result("x") }))).toBe("NOT_FOUND");
    }
    expect(await kept(studentId)).toEqual([]);
  });
});
