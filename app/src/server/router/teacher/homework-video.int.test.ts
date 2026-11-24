import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { eq, sql } from "drizzle-orm";
import { closeDb, db } from "../../db/client";
import { homework as homeworkTable, libraryMaterial, student as studentTable } from "../../db/schema";
import type { HomeworkDocument } from "../../../domain/homework-format";
import { lockTaskVideos } from "../../homework/videos";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleLibraryFileRequest, handleLibraryVideoUpload, handleRouterRequest } from "../index";

// A video in homework (#330): «Добавить видео» copies a library video's
// confirmed tasks into a draft, each carrying the video; the student of the
// published homework gets the video, never the keys, and its file; nobody
// else does; a later change of the video's tasks leaves the homework as it
// was; a library id the teacher has no video for is refused wherever a
// homework is saved; a YouTube link is embedded, another link opened; a
// video a homework uses is not deleted (product owner, 2026-11-24). The
// video's bytes and the tasks are synthetic.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;
let other: ReturnType<typeof createServerCaller>;
let assistant: ReturnType<typeof createServerCaller>;
let teacherHeaders: Headers;

const run = crypto.randomUUID().slice(0, 8);
const MP4_HEAD = Buffer.from("\0\0\0\x18ftypisom\0\0\0\0isommp41", "latin1");
const trueFalse = (prompt: string, answer: 0 | 1) => ({ type: "single_choice", prompt, options: ["True", "False"], answer, topic: `robot ${run}` });
const VIDEO_TASKS = { version: 1, title: "Robot homework", tasks: [trueFalse("The robot sleeps at nine.", 0), trueFalse("The robot reads a book.", 1)] };
const homework = (tasks: unknown[]) =>
  JSON.stringify({ version: 1, title: `Video homework ${run}`, tasks: [{ type: "single_choice", prompt: "Pick the sky.", options: ["blue", "green"], answer: 0 }, ...tasks] });
/** Whether `promise` settles within `ms`. */
const settledWithin = (promise: Promise<unknown>, ms: number) =>
  Promise.race([promise.then(() => true, () => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms))]);
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** An own library video with confirmed tasks, uploaded by `caller`; returns its id. */
async function videoWithTasks(caller: ReturnType<typeof createServerCaller>, headers: Headers, title: string) {
  const response = await handleLibraryVideoUpload(
    new Request(`${env().APP_URL}/api/files/library`, { method: "PUT", headers, body: Buffer.concat([MP4_HEAD, Buffer.alloc(2000)]) }),
  );
  const { file } = (await response.json()) as { file: string };
  const { id } = await caller.teacher.library.addVideoFile({ title, level: "A2", topic: `homework video ${run}`, ageGroup: "younger", file });
  return id;
}

async function confirm(id: string, tasks: unknown) {
  await assistant.agent.saveVideoTasksDraft({ videoId: id, tasks });
  await teacher.teacher.library.confirmVideoTasks({ id, revision: (await teacher.teacher.library.videoTasks({ id })).draft!.revision });
}

/** A new student of teacher A with a link session; returns the student's id and their caller and headers. */
async function student(firstName: string) {
  const { id: studentId } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  const token = (await teacher.teacher.links.student({ studentId })).url.split("#")[1]!;
  const response = await handleRouterRequest(
    new Request(`${env().APP_URL}/api/trpc/links.exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }),
  );
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES.student}=`))!.split(";")[0]!;
  const headers = new Headers({ cookie });
  return { studentId, headers, caller: createServerCaller(headers) };
}

const fileStatus = async (headers: Headers, id: string) =>
  (await handleLibraryFileRequest(new Request(`${env().APP_URL}/api/files/library/${id}`, { headers }), id)).status;

beforeAll(async () => {
  teacherHeaders = await signedInHeaders(teacherA);
  teacher = createServerCaller(teacherHeaders);
  other = createServerCaller(await signedInHeaders(teacherB));
  assistant = createServerCaller(new Headers({ authorization: `Bearer ${(await teacher.teacher.assistant.createToken()).token}` }));
});

afterAll(closeDb);

describe("a video in homework", () => {
  it("is added with a copy of its tasks; the student of the published homework watches it, without the keys, and nobody else gets its file", async () => {
    const videoId = await videoWithTasks(teacher, teacherHeaders, `Clip ${run}`);
    await confirm(videoId, VIDEO_TASKS);
    const watcher = await student("Смотрит видео дома");
    const bystander = await student("Не смотрит видео");
    const { id } = await teacher.teacher.homework.import({ studentId: watcher.studentId, json: homework([]) });

    expect((await teacher.teacher.homework.videosToAdd()).find((v) => v.id === videoId)).toEqual({
      id: videoId,
      title: `Clip ${run}`,
      video: { title: `Clip ${run}`, file: `/api/files/library/${videoId}` },
    });
    // «Добавить в домашку»: the copies, keys included, each carrying the video; the editor appends and saves them.
    const copies = await teacher.teacher.homework.videoTasks({ id, materialId: videoId });
    expect(copies).toEqual(VIDEO_TASKS.tasks.map((task) => ({ ...task, video: { library: videoId } })));
    const draft = await teacher.teacher.homework.get({ id });
    const { revision } = await teacher.teacher.homework.updateTasks({ id, revision: draft.revision, tasks: [...draft.tasks, ...copies] });
    expect((await teacher.teacher.homework.taskVideos({ id }))[1]).toEqual({ title: `Clip ${run}`, file: `/api/files/library/${videoId}` });

    // A draft's video is not the student's yet.
    expect(await fileStatus(watcher.headers, videoId)).toBe(404);
    await teacher.teacher.homework.publish({ id, revision, dueDate: inDays(3) });

    const opened = await watcher.caller.student.homework.open({ id });
    expect(opened.tasks[0]!.video).toBeUndefined();
    expect(opened.tasks.slice(1).map((t) => [t.prompt, t.video])).toEqual([
      ["The robot sleeps at nine.", { title: `Clip ${run}`, file: `/api/files/library/${videoId}` }],
      ["The robot reads a book.", { title: `Clip ${run}`, file: `/api/files/library/${videoId}` }],
    ]);
    expect(JSON.stringify(opened)).not.toMatch(/"answer"|"library"/);
    expect(await fileStatus(watcher.headers, videoId)).toBe(200);
    expect(await fileStatus(bystander.headers, videoId)).toBe(404);

    // Checked with the rest on «Сдать».
    for (const [index, choice] of [[0, 0], [1, 0], [2, 0]] as const) {
      await watcher.caller.student.homework.saveAnswer({ id, taskIndex: index, answer: { type: "single_choice", choice } });
    }
    await watcher.caller.student.homework.submit({ id, idempotencyKey: crypto.randomUUID() });
    expect((await teacher.teacher.homework.list({ studentId: watcher.studentId })).find((h) => h.id === id)!.status).toBe("submitted");
  });

  it("keeps its copied tasks when the video's tasks change afterwards", async () => {
    const videoId = await videoWithTasks(teacher, teacherHeaders, `Changing clip ${run}`);
    await confirm(videoId, VIDEO_TASKS);
    const { studentId } = await student("Копия заданий");
    const { id } = await teacher.teacher.homework.import({ studentId, json: homework([]) });
    const draft = await teacher.teacher.homework.get({ id });
    await teacher.teacher.homework.updateTasks({ id, revision: draft.revision, tasks: [...draft.tasks, ...(await teacher.teacher.homework.videoTasks({ id, materialId: videoId }))] });

    await confirm(videoId, { ...VIDEO_TASKS, tasks: [trueFalse("The robot swims.", 1)] });
    expect((await teacher.teacher.homework.get({ id })).tasks.map((t) => t.prompt)).toEqual(["Pick the sky.", "The robot sleeps at nine.", "The robot reads a book."]);
  });

  it("refuses a library id the teacher has no video for, in the import, the editor and the assistant's draft", async () => {
    const theirs = await videoWithTasks(other, await signedInHeaders(teacherB), `Their clip ${run}`);
    const { studentId } = await student("Чужое видео");
    const foreign = { ...trueFalse("About their clip.", 0), video: { library: theirs } };
    await expect(teacher.teacher.homework.import({ studentId, json: homework([foreign]) })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Задание 2, поле video: в библиотеке нет такого видео",
    });
    const { id } = await teacher.teacher.homework.import({ studentId, json: homework([]) });
    const draft = await teacher.teacher.homework.get({ id });
    await expect(teacher.teacher.homework.updateTasks({ id, revision: draft.revision, tasks: [...draft.tasks, foreign] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(teacher.teacher.homework.videoTasks({ id, materialId: theirs })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(assistant.agent.saveHomeworkDraft({ studentId, homework: JSON.parse(homework([foreign])) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("is not deleted while a homework not yet submitted uses it, and the refusal names the homework; once submitted, or with no homework using it, it is", async () => {
    const videoId = await videoWithTasks(teacher, teacherHeaders, `Kept clip ${run}`);
    await confirm(videoId, VIDEO_TASKS);
    const { studentId, caller } = await student("Держит видео");
    const withVideo = async () => {
      const { id } = await teacher.teacher.homework.import({ studentId, json: homework([]) });
      const draft = await teacher.teacher.homework.get({ id });
      const { revision } = await teacher.teacher.homework.updateTasks({
        id,
        revision: draft.revision,
        tasks: [...draft.tasks, ...(await teacher.teacher.homework.videoTasks({ id, materialId: videoId }))],
      });
      return { id, revision };
    };
    const refused = { code: "CONFLICT", message: expect.stringContaining(`«Video homework ${run}» (Держит видео)`) };

    const draft = await withVideo();
    await expect(teacher.teacher.library.remove({ id: videoId })).rejects.toMatchObject(refused);
    // Another teacher cannot learn that the video exists.
    await expect(other.teacher.library.remove({ id: videoId })).rejects.toMatchObject({ code: "NOT_FOUND" });

    // The draft without the video's tasks no longer keeps it; a published homework does.
    const tasks = (await teacher.teacher.homework.get({ id: draft.id })).tasks.filter((task) => !task.video);
    await teacher.teacher.homework.updateTasks({ id: draft.id, revision: draft.revision, tasks });
    const published = await withVideo();
    await teacher.teacher.homework.publish({ id: published.id, revision: published.revision, dueDate: inDays(3) });
    await expect(teacher.teacher.library.remove({ id: videoId })).rejects.toMatchObject(refused);
    expect((await teacher.teacher.homework.taskVideos({ id: published.id }))[1]).toEqual({ title: `Kept clip ${run}`, file: `/api/files/library/${videoId}` });

    // Submitted, the homework keeps its tasks and answers, not the video (product owner, 2026-11-24).
    for (const taskIndex of [0, 1, 2]) {
      await caller.student.homework.saveAnswer({ id: published.id, taskIndex, answer: { type: "single_choice", choice: 0 } });
    }
    await caller.student.homework.submit({ id: published.id, idempotencyKey: crypto.randomUUID() });
    await expect(teacher.teacher.library.remove({ id: videoId })).resolves.toEqual({ id: videoId });
    expect((await teacher.teacher.homework.get({ id: published.id })).tasks).toHaveLength(3);
    expect((await teacher.teacher.homework.taskVideos({ id: published.id }))[1]).toBeNull();

    // A video no homework uses is deleted.
    const unused = await videoWithTasks(teacher, teacherHeaders, `Unused clip ${run}`);
    await expect(teacher.teacher.library.remove({ id: unused })).resolves.toEqual({ id: unused });
  });

  it("a save holding the video makes a deletion wait, and the deletion then sees the homework and is refused", async () => {
    const videoId = await videoWithTasks(teacher, teacherHeaders, `Raced clip ${run}`);
    await confirm(videoId, VIDEO_TASKS);
    const { studentId } = await student("Гонка сохранения");
    const [{ teacherId }] = (await db().select({ teacherId: studentTable.teacherId }).from(studentTable).where(eq(studentTable.id, studentId))) as [{ teacherId: string }];
    const document = { version: 1, title: `Raced homework ${run}`, tasks: [{ ...trueFalse("About the raced clip.", 0), video: { library: videoId } }] } as HomeworkDocument;

    let deletion: Promise<unknown> | undefined;
    await db().transaction(async (tx) => {
      // The save's read: the video is held.
      await lockTaskVideos(tx, teacherId, document);
      // The competing deletion waits for it.
      deletion = teacher.teacher.library.remove({ id: videoId });
      deletion.catch(() => undefined);
      expect(await settledWithin(deletion, 300)).toBe(false);
      // The save's write.
      await tx.insert(homeworkTable).values({ teacherId, studentId, title: document.title, document });
    });
    await expect(deletion).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("a deletion holding the video makes a save wait, and the save then finds the video gone and is refused", async () => {
    const videoId = await videoWithTasks(teacher, teacherHeaders, `Deleted while saved ${run}`);
    await confirm(videoId, VIDEO_TASKS);
    const { studentId } = await student("Гонка удаления");
    const { id } = await teacher.teacher.homework.import({ studentId, json: homework([]) });
    const draft = await teacher.teacher.homework.get({ id });
    const tasks = [...draft.tasks, ...(await teacher.teacher.homework.videoTasks({ id, materialId: videoId }))];

    let save: Promise<unknown> | undefined;
    await db().transaction(async (tx) => {
      // The deletion's lock and its check found no homework.
      await tx.select({ id: libraryMaterial.id }).from(libraryMaterial).where(eq(libraryMaterial.id, videoId)).for("update");
      // The competing save passes its early check and waits at the lock.
      save = teacher.teacher.homework.updateTasks({ id, revision: draft.revision, tasks });
      save.catch(() => undefined);
      expect(await settledWithin(save, 300)).toBe(false);
      // The deletion's write.
      await tx.delete(libraryMaterial).where(eq(libraryMaterial.id, videoId));
    });
    await expect(save).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("в библиотеке нет такого видео") });
    expect((await teacher.teacher.homework.get({ id })).tasks).toHaveLength(1);
  });

  it("serves a homework's library id to the student only when it is a video and not a draft", async () => {
    const watcher = await student("Не видео");
    const { id: game } = await teacher.teacher.library.addGame({ title: `Not a clip ${run}`, level: "A2", topic: `homework video ${run}`, ageGroup: "younger", html: "<!doctype html><html><body>game</body></html>" });
    const { id } = await teacher.teacher.homework.import({ studentId: watcher.studentId, json: homework([]) });
    await teacher.teacher.homework.publish({ id, revision: (await teacher.teacher.homework.get({ id })).revision, dueDate: inDays(3) });
    // No save path takes such a task; written straight to the document, it still opens nothing.
    await db()
      .update(homeworkTable)
      .set({ document: sql`jsonb_set(${homeworkTable.document}, '{tasks,0,video}', ${JSON.stringify({ library: game })}::jsonb)` })
      .where(eq(homeworkTable.id, id));
    expect(await fileStatus(watcher.headers, game)).toBe(404);
  });

  it("embeds a YouTube link and leaves any other link to open in a new tab", async () => {
    const watcher = await student("Ссылки на видео");
    const youTube = { ...trueFalse("About the YouTube clip.", 0), video: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } };
    const elsewhere = { ...trueFalse("About the other clip.", 0), video: { url: "https://video.example.test/robot" } };
    const { id } = await teacher.teacher.homework.import({ studentId: watcher.studentId, json: homework([youTube, elsewhere]) });
    await teacher.teacher.homework.publish({ id, revision: (await teacher.teacher.homework.get({ id })).revision, dueDate: inDays(3) });
    const { tasks } = await watcher.caller.student.homework.open({ id });
    expect(tasks[1]!.video).toEqual({ title: "Видео", embed: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" });
    expect(tasks[2]!.video).toEqual({ title: "Видео", link: "https://video.example.test/robot" });
  });
});
