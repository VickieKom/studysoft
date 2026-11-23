import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { closeDb } from "../../db/client";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleLibraryFileRequest, handleLibraryVideoUpload, handleRouterRequest } from "../index";

// A video in homework (#330): «Добавить видео» copies a library video's
// confirmed tasks into a draft, each carrying the video; the student of the
// published homework gets the video, never the keys, and its file; nobody
// else does; a later change of the video's tasks leaves the homework as it
// was; a library id the teacher has no video for is refused wherever a
// homework is saved; a YouTube link is embedded, another link opened. The
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
