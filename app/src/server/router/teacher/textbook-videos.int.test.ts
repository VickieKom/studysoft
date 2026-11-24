import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { closeDb, db } from "../../db/client";
import { lesson as lessonTable } from "../../db/schema";
import { openTextbookVideos } from "../../library/textbook-videos";
import { env } from "../../env";
import { pdf } from "../../testing/files";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest, handleTextbookFileRequest, handleTextbookUpload } from "../index";

// Videos of a textbook set (#329): uploaded with the set as MP4, WebM or MOV
// up to 200 MB, marked on a lesson in the structure by name; a lesson's
// preparation takes one as a stage with tasks of the lesson's bank; opened
// from the preparation, the student watches it with those tasks copied,
// until an hour after the lesson's end — moved with the lesson, ended by
// cancelling it — and answers them as under a library video (#327); the
// lesson stage reviews the answers (#328). Only tasks fit for a video are
// offered, and a bank changed after the pick is refused. Nobody else gets
// its file. The video's bytes, the book and the tasks are synthetic.

const [teacherA] = seedTeachers as [(typeof seedTeachers)[number]];
let teacherHeaders: Headers;
let teacher: ReturnType<typeof createServerCaller>;
let assistant: ReturnType<typeof createServerCaller>;
let textbookId: string;
let videoFileId: string;
let lessons: { id: string; title: string }[];

const run = crypto.randomUUID().slice(0, 8);
const MP4_HEAD = Buffer.from("\0\0\0\x18ftypisom\0\0\0\0isommp41", "latin1");
const isoIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const trueFalse = (prompt: string, answer: 0 | 1, exercise: string) => ({
  type: "single_choice",
  prompt,
  options: ["True", "False"],
  answer,
  topic: `textbook video ${run}`,
  skill: "listening",
  source: { book: "Workbook", unit: "1", page: "5", exercise },
});
// The voice task cannot go under a video (#327): offered tasks keep their bank positions, 0, 2 and 3.
const voiceTask = { type: "voice", prompt: "Say what the fox does.", topic: `textbook video ${run}`, skill: "speaking", source: { book: "Workbook", unit: "1", page: "5", exercise: "4" } };
const bankTasks = [trueFalse("The fox jumps.", 0, "1"), voiceTask, trueFalse("The fox sleeps.", 1, "2"), trueFalse("The fox sings.", 1, "3")];
const offered = [0, 2, 3];

async function upload(kind: "book" | "video", body: Uint8Array<ArrayBuffer>) {
  const response = await handleTextbookUpload(new Request(`${env().APP_URL}/api/files/textbooks?kind=${kind}`, { method: "PUT", headers: teacherHeaders, body }));
  return { status: response.status, body: (await response.json()) as { file?: string; error?: string } };
}

/** A new student who passed 1.1, with a lesson in two days and a link session; their caller and headers. */
async function studentWithLesson(firstName: string) {
  const { id: studentId } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  await teacher.teacher.prep.setStudentTextbook({ studentId, textbookId, passedLessonId: lessons[0]!.id });
  const { id: lessonId } = await teacher.teacher.schedule.addLesson({ studentId, date: isoIn(2), time: "10:00", durationMinutes: 45, intro: false });
  const token = (await teacher.teacher.links.student({ studentId })).url.split("#")[1]!;
  const response = await handleRouterRequest(
    new Request(`${env().APP_URL}/api/trpc/links.exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }),
  );
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES.student}=`))!.split(";")[0]!;
  const headers = new Headers({ cookie });
  return { studentId, lessonId, headers, student: createServerCaller(headers) };
}

const bankRevision = async (lessonId: string) => (await teacher.teacher.prep.get({ lessonId })).textbookVideos[0]!.revision;
const videoStage = (tasks: number[], revision: string, fileId = videoFileId, lessonId = lessons[1]!.id) => ({
  type: "textbook_video" as const,
  fileId,
  lessonId,
  tasks,
  revision,
  minutes: 10,
});
/** Confirms `tasks` as the bank of lesson 1.2, replacing what it had. */
async function confirmBank(tasks: unknown[]) {
  await assistant.agent.saveTextbookLessonTasks({ textbookId, lessonId: lessons[1]!.id, tasks });
  const bank = (await teacher.teacher.textbooks.taskBank({ id: textbookId })).find((l) => l.lessonId === lessons[1]!.id)!;
  await teacher.teacher.textbooks.confirmBankLesson({ textbookId, lessonId: lessons[1]!.id, revision: bank.draft!.revision });
}
const savePlan = (lessonId: string, stages: unknown[]) => teacher.teacher.prep.save({ lessonId, plan: { stages }, homeworkId: null, revision: "" });
const fileStatus = async (headers: Headers, id: string) =>
  (await handleTextbookFileRequest(new Request(`${env().APP_URL}/api/files/textbooks/${id}`, { headers }), id, null)).status;

beforeAll(async () => {
  teacherHeaders = await signedInHeaders(teacherA);
  teacher = createServerCaller(teacherHeaders);
  assistant = createServerCaller(new Headers({ authorization: `Bearer ${(await teacher.teacher.assistant.createToken()).token}` }));
  const book = (await upload("book", new Uint8Array(pdf(6)))).body.file!;
  const video = (await upload("video", new Uint8Array(Buffer.concat([MP4_HEAD, Buffer.alloc(2000)])))).body.file!;
  ({ id: textbookId } = await teacher.teacher.textbooks.create({
    title: `Video set ${run}`,
    level: "A2",
    books: [{ kind: "students_book", name: "book.pdf", file: book }],
    tracks: [],
    videos: [{ name: "1-2-clip", file: video }],
  }));
  // The structure is checked against rendered pages: wait for the book.
  for (let i = 0; i < 100 && (await teacher.teacher.textbooks.get({ id: textbookId })).books[0]!.status !== "done"; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const lesson = (title: string, from: number, videos: string[] = []) => ({ title, pages: { students_book: { from, to: from + 1 } }, tracks: [], videos, words: [] });
  const { revision } = await teacher.teacher.textbooks.structure({ id: textbookId });
  await teacher.teacher.textbooks.saveStructure({
    id: textbookId,
    structure: { units: [{ title: "Unit 1", lessons: [lesson("1.1", 1), lesson("1.2", 3, ["1-2-clip"]), lesson("1.3", 5)] }] },
    revision,
    confirm: true,
  });
  lessons = (await teacher.teacher.textbooks.structure({ id: textbookId })).structure!.units[0]!.lessons.map((l) => ({ id: l.id!, title: l.title }));
  await confirmBank(bankTasks);
  videoFileId = (await teacher.teacher.textbooks.get({ id: textbookId })).videos[0]!.id;
});

afterAll(closeDb);

describe("a textbook's videos", () => {
  it("are listed on the set and on the lesson they are marked on", async () => {
    expect((await teacher.teacher.textbooks.get({ id: textbookId })).videos).toEqual([{ id: videoFileId, name: "1-2-clip" }]);
    expect((await teacher.teacher.textbooks.lesson({ textbookId, lessonId: lessons[1]!.id })).videos).toEqual([{ id: videoFileId, name: "1-2-clip" }]);
    expect((await teacher.teacher.textbooks.lesson({ textbookId, lessonId: lessons[0]!.id })).videos).toEqual([]);
    expect(await fileStatus(teacherHeaders, videoFileId)).toBe(200);
  });

  it("refuses a file that is not MP4, WebM or MOV, and a set with a file that is not a video in the place of one", async () => {
    const flv = await upload("video", new Uint8Array(Buffer.concat([Buffer.from("FLV"), Buffer.alloc(64)])));
    expect(flv).toMatchObject({ status: 415, body: { error: expect.stringContaining("MP4") } });
    const book = (await upload("book", new Uint8Array(pdf(1)))).body.file!;
    const other = (await upload("book", new Uint8Array(pdf(1)))).body.file!;
    await expect(
      teacher.teacher.textbooks.create({ title: "Not a video", level: "A2", books: [{ kind: "students_book", name: "b.pdf", file: book }], tracks: [], videos: [{ name: "x", file: other }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("make a stage of the preparation with bank tasks; opened from it, the student watches with those tasks and answers; the stage reviews them", async () => {
    const { lessonId, headers, student } = await studentWithLesson("Видео учебника");
    const bystander = await studentWithLesson("Без видео учебника");
    const prep = await teacher.teacher.prep.get({ lessonId });
    expect(prep.textbookVideos).toEqual([
      {
        fileId: videoFileId,
        name: "1-2-clip",
        lessonId: lessons[1]!.id,
        lessonTitle: "1.2",
        tasks: offered.map((index) => ({ index, prompt: bankTasks[index]!.prompt })),
        revision: expect.any(String),
      },
    ]);

    // Not opened until the plan has the stage and the teacher opens it.
    await expect(teacher.teacher.prep.openTextbookVideo({ lessonId, fileId: videoFileId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await savePlan(lessonId, [videoStage([0, 2], await bankRevision(lessonId))]);
    expect(await student.student.videos.list()).toEqual([]);
    expect(await fileStatus(headers, videoFileId)).toBe(404);
    await teacher.teacher.prep.openTextbookVideo({ lessonId, fileId: videoFileId });
    expect((await teacher.teacher.prep.get({ lessonId })).openedVideos).toEqual([videoFileId]);

    expect(await student.student.videos.list()).toEqual([
      { id: videoFileId, title: "1-2-clip", fileUrl: `/api/files/textbooks/${videoFileId}`, link: null, hasTasks: true },
    ]);
    const shown = (await student.student.videos.tasks({ id: videoFileId }))!;
    expect(shown.tasks.map((t) => t.prompt)).toEqual(["The fox jumps.", "The fox sleeps."]);
    expect(JSON.stringify(shown)).not.toMatch(/"answer"/);
    expect(await fileStatus(headers, videoFileId)).toBe(200);
    expect(await fileStatus(bystander.headers, videoFileId)).toBe(404);

    // Answered as under a library video: right on the jump, wrong on the sleep; the stage reviews them.
    await student.student.videos.submitTasks({
      id: videoFileId,
      revision: shown.revision,
      answers: [
        { type: "single_choice", choice: 0 },
        { type: "single_choice", choice: 0 },
      ],
    });
    const [reviewed] = await teacher.teacher.lessonMode.videos({ lessonId });
    expect(reviewed).toMatchObject({ id: videoFileId, title: "1-2-clip", answered: true });
    expect(reviewed!.tasks.map((t) => [t.prompt, t.answer, t.verdict])).toEqual([
      ["The fox jumps.", "True", true],
      ["The fox sleeps.", "True", false],
    ]);

    // Once an hour after the lesson's end has passed, it is gone for the student, their file is not served, and it is not opened again.
    await db().update(lessonTable).set({ startsAt: new Date(Date.now() - (45 + 61) * 60_000) }).where(eq(lessonTable.id, lessonId));
    expect(await student.student.videos.list()).toEqual([]);
    expect(await fileStatus(headers, videoFileId)).toBe(404);
    await expect(teacher.teacher.prep.openTextbookVideo({ lessonId, fileId: videoFileId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("follows its lesson: moved later, the access ends an hour after the new end; cancelled, it ends at once", async () => {
    const { studentId, lessonId, headers, student } = await studentWithLesson("Перенос видео учебника");
    await savePlan(lessonId, [videoStage([0], await bankRevision(lessonId))]);
    await teacher.teacher.prep.openTextbookVideo({ lessonId, fileId: videoFileId });
    const [row] = await db().select({ startsAt: lessonTable.startsAt, teacherId: lessonTable.teacherId }).from(lessonTable).where(eq(lessonTable.id, lessonId));
    const afterFirstEnd = new Date(row!.startsAt.getTime() + (45 + 61) * 60_000);
    expect(await openTextbookVideos(db(), row!.teacherId, studentId, afterFirstEnd)).toEqual([]);

    await teacher.teacher.schedule.move({ lessonId, date: isoIn(9), time: "10:00" });
    expect((await openTextbookVideos(db(), row!.teacherId, studentId, afterFirstEnd)).map((v) => v.id)).toEqual([videoFileId]);

    await teacher.teacher.schedule.cancel({ lessonId, charged: false });
    expect(await student.student.videos.list()).toEqual([]);
    expect(await fileStatus(headers, videoFileId)).toBe(404);
  });

  it("is not opened, nor its plan saved, with tasks picked from a bank that changed since; picked anew, it is", async () => {
    const { lessonId, student } = await studentWithLesson("Новый банк видео");
    const before = await bankRevision(lessonId);
    await savePlan(lessonId, [videoStage([2], before)]);
    // The bank is replaced: position 2 is another task now.
    await confirmBank([trueFalse("The fox runs.", 0, "5"), trueFalse("The fox hides.", 0, "6"), trueFalse("The fox eats.", 0, "7")]);
    await expect(teacher.teacher.prep.openTextbookVideo({ lessonId, fileId: videoFileId })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await student.student.videos.list()).toEqual([]);
    await expect(savePlan(lessonId, [videoStage([2], before)])).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/изменились/) });

    const after = await bankRevision(lessonId);
    expect(after).not.toBe(before);
    await savePlan(lessonId, [videoStage([2], after)]);
    await teacher.teacher.prep.openTextbookVideo({ lessonId, fileId: videoFileId });
    expect((await student.student.videos.tasks({ id: videoFileId }))!.tasks.map((t) => t.prompt)).toEqual(["The fox eats."]);
    await confirmBank(bankTasks);
  });

  it("refuses a stage with a video or a task the lesson does not have, or a task that cannot go under a video", async () => {
    const { lessonId } = await studentWithLesson("Чужое видео учебника");
    const revision = await bankRevision(lessonId);
    await expect(savePlan(lessonId, [videoStage([7], revision)])).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // The voice task, at position 1.
    await expect(savePlan(lessonId, [videoStage([1], revision)])).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(savePlan(lessonId, [videoStage([0], revision, crypto.randomUUID())])).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(savePlan(lessonId, [videoStage([0], revision, videoFileId, lessons[2]!.id)])).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("are refused in the structure by a name the set has no video for, as a track is", async () => {
    const { structure, revision } = await teacher.teacher.textbooks.structure({ id: textbookId });
    const typo = { units: structure!.units.map((u) => ({ ...u, lessons: u.lessons.map((l, i) => (i === 1 ? { ...l, videos: ["1-2-clp"] } : l)) })) };
    await expect(teacher.teacher.textbooks.saveStructure({ id: textbookId, structure: typo, revision, confirm: true })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("видео «1-2-clp» нет в учебнике"),
    });
  });
});
