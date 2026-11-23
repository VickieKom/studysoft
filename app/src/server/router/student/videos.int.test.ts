import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GAME_ACCESS_AFTER_LESSON_MS } from "../../../domain/library";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { closeDb, db } from "../../db/client";
import { gameAccess, lesson, libraryMaterial } from "../../db/schema";
import { env } from "../../env";
import { openGameToStudent, studentVideo, studentVideos } from "../../library/student-games";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleLibraryFileRequest, handleRouterRequest } from "../index";

// Videos opened to a student during a lesson (#158), as games are (#118):
// only while a lesson of theirs is going on, until an hour after its end, and
// only to that student. An own file is served to them; a link is only an
// address. A video is never a game for the student, nor a game a video. The
// own file is a stand-in: a game's stored file with the video kind.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
const MINUTE = 60_000;
const LINK = "https://video.example.test/watch?v=student-video";

let teacher: ReturnType<typeof createServerCaller>;
let teacherId: string;
let otherTeacher: ReturnType<typeof createServerCaller>;
let otherTeacherId: string;

const run = crypto.randomUUID().slice(0, 8);
const tags = (title: string) => ({ title, level: "A2" as const, topic: `videos ${run}`, ageGroup: "younger" as const });

/** An own video stand-in: a stored file with the video kind. */
async function ownVideo(title: string, as = teacher) {
  const { id } = await as.teacher.library.addGame({ ...tags(title), html: "<!doctype html><title>v</title>" });
  await db().update(libraryMaterial).set({ kind: "video" }).where(eq(libraryMaterial.id, id));
  return id;
}

const linkVideo = async (title: string) => (await teacher.teacher.library.addVideoLink({ ...tags(title), url: LINK })).id;

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

async function newStudent(firstName: string) {
  const { id } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  return sessionOf(id);
}

async function addLesson(owner: string, studentId: string, startsAt: Date, minutes = 45) {
  const [row] = await db().insert(lesson).values({ teacherId: owner, studentId, startsAt, durationMinutes: minutes }).returning({ id: lesson.id });
  return row!.id;
}

async function fileOf(headers: Headers, id: string, range?: string) {
  const request = new Request(`${env().APP_URL}/api/files/library/${id}`, { headers: range ? new Headers([...headers, ["range", range]]) : headers });
  const response = await handleLibraryFileRequest(request, id);
  return { status: response.status, body: await response.text() };
}

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  teacherId = (await teacher.teacher.session.me()).id;
  otherTeacher = createServerCaller(await signedInHeaders(teacherB));
  otherTeacherId = (await otherTeacher.teacher.session.me()).id;
});

afterAll(closeDb);

describe("videos opened to a student", () => {
  it("opens an own video and a link during a lesson; the student lists and gets them, the file in ranges, and nobody else does", async () => {
    const own = await ownVideo(`Own clip ${run}`);
    const link = await linkVideo(`Link clip ${run}`);
    const viewer = await newStudent("Видеозритель");
    await addLesson(teacherId, viewer.studentId, new Date(Date.now() - 5 * MINUTE));

    expect(await viewer.student.student.videos.list()).toEqual([]);
    await teacher.teacher.library.openToStudent({ id: own, studentId: viewer.studentId });
    await teacher.teacher.library.openToStudent({ id: link, studentId: viewer.studentId });
    expect((await teacher.teacher.library.openedTo({ id: own })).students.map((s) => s.studentId)).toEqual([viewer.studentId]);

    expect(await viewer.student.student.videos.list()).toEqual([
      { id: link, title: `Link clip ${run}`, fileUrl: null, link: LINK, hasTasks: false },
      { id: own, title: `Own clip ${run}`, fileUrl: `/api/files/library/${own}`, link: null, hasTasks: false },
    ]);
    expect(await viewer.student.student.videos.get({ id: own })).toMatchObject({ fileUrl: `/api/files/library/${own}` });
    expect((await fileOf(viewer.headers, own)).status).toBe(200);
    expect((await fileOf(viewer.headers, own, "bytes=0-4")).status).toBe(206);
    // A link has no file.
    expect((await fileOf(viewer.headers, link)).status).toBe(404);
    // A video is not a game for the student.
    expect(await viewer.student.student.games.list()).toEqual([]);
    await expect(viewer.student.student.games.get({ id: own })).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Another student of hers, and another teacher's student: the same 404 as for a missing video.
    const neighbour = await newStudent("Соседний зритель");
    const missing = "00000000-0000-4000-8000-000000000000";
    expect(await neighbour.student.student.videos.list()).toEqual([]);
    await expect(neighbour.student.student.videos.get({ id: own })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await fileOf(neighbour.headers, own)).toEqual(await fileOf(neighbour.headers, missing));
    const [stranger] = await otherTeacher.teacher.students.list();
    const foreign = await sessionOf(stranger!.id, otherTeacher);
    const foreignLesson = await addLesson(otherTeacherId, foreign.studentId, new Date(Date.now() - 5 * MINUTE));
    await expect(teacher.teacher.library.openToStudent({ id: own, studentId: foreign.studentId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(foreign.student.student.videos.get({ id: own })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await fileOf(foreign.headers, own)).status).toBe(404);
    await db().delete(lesson).where(eq(lesson.id, foreignLesson));
  });

  it("keeps the video open until exactly one hour after the lesson's end, and not a moment longer", async () => {
    const own = await ownVideo(`Boundary clip ${run}`);
    const { studentId, headers } = await newStudent("Граница видео");
    const startsAt = new Date(Date.now() - 20 * MINUTE);
    await addLesson(teacherId, studentId, startsAt, 45);
    const until = await openGameToStudent(db(), teacherId, own, studentId);
    expect(until).toEqual(new Date(startsAt.getTime() + 45 * MINUTE + GAME_ACCESS_AFTER_LESSON_MS));

    const justBefore = new Date(until!.getTime() - 1);
    expect((await studentVideos(db(), teacherId, studentId, justBefore)).map((v) => v.id)).toEqual([own]);
    expect(await studentVideo(db(), teacherId, studentId, own, justBefore)).not.toBeNull();
    expect(await studentVideos(db(), teacherId, studentId, until!)).toEqual([]);
    expect(await studentVideo(db(), teacherId, studentId, own, until!)).toBeNull();

    await db().update(gameAccess).set({ until: new Date(Date.now() - 1) }).where(eq(gameAccess.materialId, own));
    expect((await fileOf(headers, own)).status).toBe(404);
  });

  it("is refused without a lesson going on", async () => {
    const own = await ownVideo(`No lesson clip ${run}`);
    const { studentId } = await newStudent("Без урока видео");
    await addLesson(teacherId, studentId, new Date(Date.now() + MINUTE));
    await expect(teacher.teacher.library.openToStudent({ id: own, studentId })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("урок"),
    });
    expect(await db().select().from(gameAccess).where(eq(gameAccess.materialId, own))).toEqual([]);
  });

  it("keeps no game result for a video open to the student", async () => {
    const own = await ownVideo(`Result clip ${run}`);
    const viewer = await newStudent("Видео без итога");
    await addLesson(teacherId, viewer.studentId, new Date(Date.now() - 5 * MINUTE));
    await teacher.teacher.library.openToStudent({ id: own, studentId: viewer.studentId });
    const result = { type: "studysoft.game-result", version: 1, answers: [{ task: "t", answer: "a", correct: false, topic: "x" }] };
    await expect(viewer.student.student.games.saveResult({ id: own, result })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
