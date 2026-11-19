import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GAME_ACCESS_AFTER_LESSON_MS } from "../../../domain/library";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { closeDb, db } from "../../db/client";
import { gameAccess, lesson, libraryMaterial } from "../../db/schema";
import { env } from "../../env";
import { openGameToStudent, studentGame, studentGames, studentsInLesson } from "../../library/student-games";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleLibraryFileRequest, handleRouterRequest } from "../index";

// Games opened to a student during a lesson (#118): only while a lesson of
// theirs is going on, until an hour after its end, and only to that student.
// The games are synthetic HTML written here; the lessons are inserted with
// the moments each test needs.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
const MINUTE = 60_000;
const MISSING = "00000000-0000-4000-8000-000000000000";

let teacher: ReturnType<typeof createServerCaller>;
let teacherId: string;
let otherTeacher: ReturnType<typeof createServerCaller>;
let otherTeacherId: string;

const run = crypto.randomUUID().slice(0, 8);
const html = (title: string) => `<!doctype html><html><body><h1>${title}</h1></body></html>`;

async function addGame(title: string, as = teacher) {
  return (await as.teacher.library.addGame({ title, level: "A2", topic: `games ${run}`, ageGroup: "younger", html: html(title) })).id;
}

/** A link session for a student of this teacher. */
async function sessionOf(studentId: string, as = teacher) {
  const token = (await as.teacher.links.student({ studentId })).url.split("#")[1]!;
  const response = await handleRouterRequest(
    new Request(`${env().APP_URL}/api/trpc/links.exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }),
  );
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES.student}=`))!.split(";")[0]!;
  const headers = new Headers({ cookie });
  return { studentId, headers, student: createServerCaller(headers) };
}

/** A new student of the first teacher and their link session. */
async function newStudent(firstName: string) {
  const { id } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  return sessionOf(id);
}

/**
 * The second teacher's seed student: other tests count that teacher's
 * students, so none is added there, and the lessons given to this one are
 * removed after each test.
 */
async function strangerStudent() {
  const [first] = await otherTeacher.teacher.students.list();
  return sessionOf(first!.id, otherTeacher);
}

/** A lesson of the student starting at `startsAt`, `minutes` long. */
async function addLesson(owner: string, studentId: string, startsAt: Date, minutes = 45, status = "scheduled") {
  const [row] = await db()
    .insert(lesson)
    .values({ teacherId: owner, studentId, startsAt, durationMinutes: minutes, status })
    .returning({ id: lesson.id });
  return row!.id;
}

async function fileStatus(headers: Headers, id: string) {
  const response = await handleLibraryFileRequest(new Request(`${env().APP_URL}/api/files/library/${id}`, { headers }), id);
  return { status: response.status, body: await response.text() };
}

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  teacherId = (await teacher.teacher.session.me()).id;
  otherTeacher = createServerCaller(await signedInHeaders(teacherB));
  otherTeacherId = (await otherTeacher.teacher.session.me()).id;
});

afterAll(closeDb);

describe("games opened to a student", () => {
  it("opens a game during a lesson; the student lists, opens and loads it, and nobody else can", async () => {
    const game = await addGame("Opened");
    const player = await newStudent("Игрок");
    const neighbour = await newStudent("Сосед");
    const stranger = await strangerStudent();
    await addLesson(teacherId, player.studentId, new Date(Date.now() - 10 * MINUTE));

    const inLesson = await teacher.teacher.library.studentsInLesson();
    expect(inLesson.map((s) => s.studentId)).toContain(player.studentId);
    expect(inLesson.map((s) => s.studentId)).not.toContain(neighbour.studentId);

    expect(await player.student.student.games.list()).toEqual([]);
    expect((await fileStatus(player.headers, game)).status).toBe(404);

    await teacher.teacher.library.openToStudent({ id: game, studentId: player.studentId });
    expect((await teacher.teacher.library.openedTo({ id: game })).students.map((s) => s.name)).toEqual(["Игрок"]);

    const fileUrl = `/api/files/library/${game}`;
    expect(await player.student.student.games.list()).toEqual([{ id: game, title: "Opened", fileUrl }]);
    expect(await player.student.student.games.get({ id: game })).toEqual({ id: game, title: "Opened", fileUrl });
    const served = await fileStatus(player.headers, game);
    expect(served).toEqual({ status: 200, body: html("Opened") });

    // Another student of the teacher, another teacher's student and no session: the same 404 as a missing game.
    const missing = await fileStatus(player.headers, MISSING);
    expect(missing.status).toBe(404);
    for (const headers of [neighbour.headers, stranger.headers, new Headers()]) {
      expect(await fileStatus(headers, game)).toEqual(missing);
    }
    for (const other of [neighbour, stranger]) {
      expect(await other.student.student.games.list()).toEqual([]);
      await expect(other.student.student.games.get({ id: game })).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await expect(player.student.student.games.get({ id: MISSING })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Another teacher sees nothing of it and cannot open it.
    await expect(otherTeacher.teacher.library.openedTo({ id: game })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(otherTeacher.teacher.library.openToStudent({ id: game, studentId: player.studentId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("keeps the game open until exactly one hour after the lesson's end, and not a moment longer", async () => {
    const game = await addGame("Boundary");
    const { studentId, headers } = await newStudent("Граница");
    const startsAt = new Date(Date.now() - 20 * MINUTE);
    await addLesson(teacherId, studentId, startsAt, 45);
    const end = new Date(startsAt.getTime() + 45 * MINUTE);
    const until = await openGameToStudent(db(), teacherId, game, studentId);
    expect(until).toEqual(new Date(end.getTime() + GAME_ACCESS_AFTER_LESSON_MS));

    const justBefore = new Date(until!.getTime() - 1);
    expect(await studentGames(db(), teacherId, studentId, justBefore)).toEqual([{ id: game, title: "Boundary" }]);
    expect(await studentGame(db(), teacherId, studentId, game, justBefore)).not.toBeNull();
    expect(await studentGames(db(), teacherId, studentId, until!)).toEqual([]);
    expect(await studentGame(db(), teacherId, studentId, game, until!)).toBeNull();

    // Once the hour is over, the file is gone for the student too.
    await db().update(gameAccess).set({ until: new Date(Date.now() - 1) }).where(eq(gameAccess.materialId, game));
    expect((await fileStatus(headers, game)).status).toBe(404);
  });

  it("is not offered and refused without a lesson going on: before, after, cancelled or missed, and for a video or a draft", async () => {
    const game = await addGame("Not now");
    const { studentId } = await newStudent("Безурочный");
    const now = Date.now();
    // Starts in a minute; ended a minute ago; going on but cancelled; going on but missed.
    await addLesson(teacherId, studentId, new Date(now + MINUTE));
    await addLesson(teacherId, studentId, new Date(now - 46 * MINUTE), 45);
    await addLesson(teacherId, studentId, new Date(now - 10 * MINUTE), 45, "cancelled");
    await addLesson(teacherId, studentId, new Date(now - 10 * MINUTE), 45, "missed");

    expect((await studentsInLesson(db(), teacherId)).map((s) => s.studentId)).not.toContain(studentId);
    await expect(teacher.teacher.library.openToStudent({ id: game, studentId })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("урок"),
    });

    // A lesson going on, but the material is a video: only games are opened.
    const { studentId: watcher } = await newStudent("Зритель");
    await addLesson(teacherId, watcher, new Date(now - 5 * MINUTE));
    const { id: video } = await teacher.teacher.library.addGame({ title: "Video stand-in", level: "A1", topic: "", ageGroup: "younger", html: html("v") });
    await db().update(libraryMaterial).set({ kind: "video" }).where(eq(libraryMaterial.id, video));
    await expect(teacher.teacher.library.openToStudent({ id: video, studentId: watcher })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // The assistant's draft (#120) is not in the library yet: it is not opened either.
    const draft = await addGame("Draft stand-in");
    await db().update(libraryMaterial).set({ draft: true }).where(eq(libraryMaterial.id, draft));
    await expect(teacher.teacher.library.openToStudent({ id: draft, studentId: watcher })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await db().select().from(gameAccess).where(eq(gameAccess.materialId, draft))).toEqual([]);
    // Another teacher's student, even one in a lesson now with their own teacher.
    const { studentId: foreign } = await strangerStudent();
    const foreignLesson = await addLesson(otherTeacherId, foreign, new Date(now - 5 * MINUTE));
    await expect(teacher.teacher.library.openToStudent({ id: game, studentId: foreign })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await db().select().from(gameAccess).where(eq(gameAccess.materialId, game))).toEqual([]);
    await db().delete(lesson).where(eq(lesson.id, foreignLesson));
  });

  it("opened again in a later lesson the access moves on, never back; a deleted game is gone at once", async () => {
    const game = await addGame("Again");
    const { studentId, student, headers } = await newStudent("Повторный");
    const now = Date.now();
    await addLesson(teacherId, studentId, new Date(now - 30 * MINUTE), 60);
    const first = await openGameToStudent(db(), teacherId, game, studentId, new Date(now));
    // A later lesson that ends sooner does not shorten the access, and removing it does not take the access away.
    const shorter = await addLesson(teacherId, studentId, new Date(now + 10 * MINUTE), 15);
    const second = await openGameToStudent(db(), teacherId, game, studentId, new Date(now + 15 * MINUTE));
    expect(second).toEqual(first);
    await db().delete(lesson).where(eq(lesson.id, shorter));
    expect(await db().select({ id: gameAccess.id }).from(gameAccess).where(eq(gameAccess.materialId, game))).toHaveLength(1);
    // One that ends later moves it on.
    await addLesson(teacherId, studentId, new Date(now + 2 * 60 * MINUTE), 60);
    const third = await openGameToStudent(db(), teacherId, game, studentId, new Date(now + 2 * 60 * MINUTE + MINUTE));
    expect(third!.getTime()).toBe(now + 4 * 60 * MINUTE);
    expect(await db().select({ id: gameAccess.id }).from(gameAccess).where(eq(gameAccess.materialId, game))).toHaveLength(1);

    await teacher.teacher.library.remove({ id: game });
    expect(await student.student.games.list()).toEqual([]);
    expect((await fileStatus(headers, game)).status).toBe(404);
    expect(await db().select().from(gameAccess).where(eq(gameAccess.materialId, game))).toEqual([]);
  });
});
