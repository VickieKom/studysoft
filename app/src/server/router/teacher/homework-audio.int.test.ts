import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HomeworkDocument } from "../../../domain/homework-format";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { removeUnreferencedBlobs } from "../../blob/store";
import { closeDb, db } from "../../db/client";
import { blob, homework } from "../../db/schema";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleHomeworkImageRequest, handleRouterRequest } from "../index";

// A recording inside a task (#127): checked at import, kept once for the
// tasks that share it, served to the teacher and to the student of the
// published homework with byte ranges, and the same 404 to anyone else. The
// recordings are synthetic, made here.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];

/** A short WAV of silence: `samples` bytes of 8-bit mono sound. */
function wav(samples = 800): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(8000, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples, 40);
  return Buffer.concat([header, Buffer.alloc(samples, 0x80)]);
}
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(64)]);
const dataUrl = (type: string, bytes: Buffer) => `data:${type};base64,${bytes.toString("base64")}`;

let teacher: ReturnType<typeof createServerCaller>;
let teacherHeaders: Headers;
let otherTeacherHeaders: Headers;

const json = (value: unknown) => JSON.stringify(value);
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const withAudio = (audios: (string | undefined)[]) => ({
  version: 1,
  title: "Listening",
  tasks: audios.map((audio, i) => ({
    type: "single_choice",
    prompt: `Listen ${i + 1}`,
    options: ["a", "b"],
    answer: 0,
    ...(audio ? { audio } : {}),
  })),
});

async function newStudent(firstName: string) {
  const { id: studentId } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  const token = (await teacher.teacher.links.student({ studentId })).url.split("#")[1]!;
  const response = await handleRouterRequest(
    new Request(`${env().APP_URL}/api/trpc/links.exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: json({ token }),
    }),
  );
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES.student}=`))!.split(";")[0]!;
  return { studentId, headers: new Headers({ cookie }) };
}

const fetchAudio = async (headers: Headers, homeworkId: string, task: string, range?: string) => {
  const request = new Request(`${env().APP_URL}/api/files/homework/${homeworkId}/${task}/audio`, {
    headers: range ? new Headers([...headers, ["Range", range]]) : headers,
  });
  const response = await handleHomeworkImageRequest(request, homeworkId, task, "audio");
  return { status: response.status, type: response.headers.get("Content-Type"), body: Buffer.from(await response.arrayBuffer()) };
};

beforeAll(async () => {
  teacherHeaders = await signedInHeaders(teacherA);
  teacher = createServerCaller(teacherHeaders);
  otherTeacherHeaders = await signedInHeaders(teacherB);
});

afterAll(closeDb);

describe("a recording inside a task", () => {
  it("is kept once for the tasks that share it, and served to the teacher and the student with ranges", async () => {
    const clip = wav();
    const { studentId, headers } = await newStudent("Слушает запись");
    const { id } = await teacher.teacher.homework.import({
      studentId,
      json: json(withAudio([dataUrl("audio/wav", clip), dataUrl("audio/wav", clip), dataUrl("audio/mp3", MP3)])),
    });
    const [row] = await db().select({ document: homework.document }).from(homework).where(eq(homework.id, id));
    const tasks = (row!.document as HomeworkDocument).tasks;
    // The same recording in two tasks is one stored file; the MP3 is stored as audio/mpeg.
    expect(tasks[0]!.audio).toMatch(/^blob:/);
    expect(tasks[1]!.audio).toBe(tasks[0]!.audio);
    const [mp3] = await db().select({ type: blob.contentType }).from(blob).where(eq(blob.id, tasks[2]!.audio!.slice(5)));
    expect(mp3!.type).toBe("audio/mpeg");

    expect(await fetchAudio(teacherHeaders, id, "0")).toEqual({ status: 200, type: "audio/wav", body: clip });
    // The student: nothing while it is a draft, the recording once it is published.
    const missing = await fetchAudio(headers, "00000000-0000-4000-8000-000000000000", "0");
    expect(missing.status).toBe(404);
    expect(await fetchAudio(headers, id, "0")).toEqual(missing);
    const { revision } = await teacher.teacher.homework.get({ id });
    await teacher.teacher.homework.publish({ id, revision, dueDate: inDays(3) });
    expect((await fetchAudio(headers, id, "1")).body).toEqual(clip);
    const part = await fetchAudio(headers, id, "1", "bytes=0-3");
    expect(part).toMatchObject({ status: 206, body: Buffer.from("RIFF") });
    // A task without a recording, another student and another teacher: the same 404.
    const other = await newStudent("Чужая запись");
    expect(await fetchAudio(other.headers, id, "0")).toEqual(missing);
    expect(await fetchAudio(otherTeacherHeaders, id, "0")).toEqual(missing);

    // The student's task points at the address, never at the stored file.
    const opened = await createServerCaller(headers).student.homework.open({ id });
    expect(opened.tasks.map((t) => t.audio)).toEqual([0, 1, 2].map((i) => `/api/files/homework/${id}/${i}/audio`));
    expect(json(opened)).not.toContain("blob:");

    // The cleanup keeps a recording a homework refers to, however old.
    await db().update(blob).set({ createdAt: new Date(Date.now() - 48 * 3_600_000) }).where(eq(blob.id, tasks[0]!.audio!.slice(5)));
    await removeUnreferencedBlobs(db());
    expect(await db().select().from(blob).where(eq(blob.id, tasks[0]!.audio!.slice(5)))).toHaveLength(1);
  });

  it("refuses another type, a recording over 10 MB and a stored reference from elsewhere, and saves nothing", async () => {
    const { studentId } = await newStudent("Не та запись");
    const cases: [string, RegExp][] = [
      [dataUrl("audio/mpeg", Buffer.from("not a recording")), /Задание 1, поле audio: это не запись/],
      [dataUrl("audio/flac", wav()), /Задание 1, поле audio/],
      [dataUrl("audio/wav", wav(10 * 1024 * 1024)), /Задание 1, поле audio: запись больше 10 МБ/],
      [`blob:${crypto.randomUUID()}`, /Задание 1, поле audio: вставьте запись/],
    ];
    for (const [audio, message] of cases) {
      await expect(teacher.teacher.homework.import({ studentId, json: json(withAudio([audio])) })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringMatching(message),
      });
    }
    expect(await teacher.teacher.homework.list({ studentId })).toEqual([]);
  });
});
