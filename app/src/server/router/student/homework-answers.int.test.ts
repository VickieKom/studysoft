import { afterAll, beforeAll, describe, expect, it } from "vitest";
import openAnswers from "../../../../../deploy/seed/homework/demo-open-answers.json";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { closeDb } from "../../db/client";
import { env } from "../../env";
import { fragmentedMp4Recording, mp4Recording, webmRecording } from "../../testing/media";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleAnswerFileRequest, handleAnswerFileUpload, handleRouterRequest } from "../index";

// Written, voice and file answers (#35). The homework is the synthetic
// deploy/seed/homework/demo-open-answers.json: 0 single choice (key: 0),
// 1 written, 2 voice, 3 a photo. The photo is a 1×1 PNG and the recordings
// are synthetic containers, all made here.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const TEN_MB = 10 * 1024 * 1024;

let teacherHeaders: Headers;
let teacher: ReturnType<typeof createServerCaller>;

const json = (value: unknown) => JSON.stringify(value);
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const url = (id: string, task: string) => `${env().APP_URL}/api/files/answers/${id}/${task}`;

/** A new student with a published copy of the synthetic homework. */
async function studentWithHomework(firstName: string) {
  const { id: studentId } = await teacher.teacher.students.create({
    firstName,
    lastName: "",
    level: "A2",
    timeZone: "Europe/Moscow",
  });
  const token = (await teacher.teacher.links.student({ studentId })).url.split("#")[1]!;
  const response = await handleRouterRequest(
    new Request(`${env().APP_URL}/api/trpc/links.exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: json({ token }),
    }),
  );
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES.student}=`))!.split(";")[0]!;
  const { id } = await teacher.teacher.homework.import({ studentId, json: json(openAnswers) });
  await teacher.teacher.homework.publish({ id, dueDate: inDays(3) });
  return { id, headers: new Headers({ cookie }), student: createServerCaller(new Headers({ cookie })) };
}

async function put(headers: Headers, id: string, task: string, body: Buffer, extra: Record<string, string> = {}) {
  const response = await handleAnswerFileUpload(
    new Request(url(id, task), { method: "PUT", headers: { cookie: headers.get("cookie") ?? "", ...extra }, body: new Uint8Array(body) }),
    id,
    task,
  );
  return { status: response.status, body: (await response.json().catch(() => null)) as Record<string, string> | null };
}

async function get(headers: Headers, id: string, task: string, extra: Record<string, string> = {}) {
  const response = await handleAnswerFileRequest(
    new Request(url(id, task), { headers: { cookie: headers.get("cookie") ?? "", ...extra } }),
    id,
    task,
  );
  return {
    status: response.status,
    type: response.headers.get("Content-Type"),
    etag: response.headers.get("ETag"),
    cache: response.headers.get("Cache-Control"),
    range: response.headers.get("Content-Range"),
    body: Buffer.from(await response.arrayBuffer()),
  };
}

beforeAll(async () => {
  teacherHeaders = await signedInHeaders(teacherA);
  teacher = createServerCaller(teacherHeaders);
});

afterAll(closeDb);

describe("open answers", () => {
  it("keeps a written answer and refuses one that does not fit its task", async () => {
    const { id, student } = await studentWithHomework("Письмо");
    await student.student.homework.saveAnswer({ id, taskIndex: 1, answer: { type: "written", text: "Two sentences." } });
    expect((await student.student.homework.open({ id })).answers[1]).toEqual({ type: "written", text: "Two sentences." });

    await expect(
      student.student.homework.saveAnswer({ id, taskIndex: 0, answer: { type: "written", text: "x" } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      student.student.homework.saveAnswer({ id, taskIndex: 1, answer: { type: "written", text: "x".repeat(5001) } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // The page cannot name a stored file: a recording or a file arrives only by its upload.
    await expect(
      student.student.homework.saveAnswer({
        id,
        taskIndex: 2,
        // @ts-expect-error -- not an answer the page may send
        answer: { type: "voice", file: crypto.randomUUID(), contentType: "audio/webm" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("serves an uploaded photo to its student and their teacher, and the same 404 as a missing one to everyone else", async () => {
    const own = await studentWithHomework("Фото");
    const other = await studentWithHomework("Другой");
    const otherTeacher = await signedInHeaders(teacherB);

    const missing = await get(own.headers, own.id, "3");
    expect(missing.status).toBe(404);

    const uploaded = await put(own.headers, own.id, "3", PNG, { "Content-Type": "image/png" });
    expect(uploaded).toEqual({ status: 200, body: { url: `/api/files/answers/${own.id}/3`, contentType: "image/png" } });
    const opened = await own.student.student.homework.open({ id: own.id });
    expect(opened.answers[3]).toEqual({ type: "file", url: `/api/files/answers/${own.id}/3`, contentType: "image/png" });
    // The stored reference never goes out.
    expect(json(opened)).not.toMatch(/"file":/);

    for (const headers of [own.headers, teacherHeaders]) {
      const served = await get(headers, own.id, "3");
      expect(served).toMatchObject({ status: 200, type: "image/png" });
      expect(served.body.equals(PNG)).toBe(true);
    }
    for (const headers of [other.headers, otherTeacher, new Headers()]) {
      expect(await get(headers, own.id, "3")).toEqual(missing);
    }
    for (const task of ["3x", "-1", "99", "03"]) expect(await get(teacherHeaders, own.id, task)).toEqual(missing);

    // Only the student uploads, and only to their own published homework.
    for (const headers of [teacherHeaders, other.headers, new Headers()]) {
      expect((await put(headers, own.id, "3", PNG)).status).toBe(404);
    }
  });

  it("refuses a file over 10 MB on the server, as well as a type the task does not take, and keeps the earlier answer", async () => {
    const { id, headers } = await studentWithHomework("Большой");
    await put(headers, id, "3", PNG);
    const huge = Buffer.concat([PNG, Buffer.alloc(TEN_MB)]);

    const declared = await put(headers, id, "3", huge);
    expect(declared.status).toBe(413);
    expect(declared.body?.error).toContain("10 МБ");
    // Without a Content-Length the body is counted as it arrives.
    const stream = new ReadableStream({
      start(controller) {
        for (let at = 0; at < huge.length; at += 1024 * 1024) controller.enqueue(huge.subarray(at, at + 1024 * 1024));
        controller.close();
      },
    });
    const streamed = await handleAnswerFileUpload(
      new Request(url(id, "3"), { method: "PUT", headers: { cookie: headers.get("cookie")! }, body: stream, duplex: "half" } as RequestInit),
      id,
      "3",
    );
    expect(streamed.status).toBe(413);

    // Exactly 10 MB is fine.
    expect((await put(headers, id, "3", Buffer.concat([PNG, Buffer.alloc(TEN_MB - PNG.length)]))).status).toBe(200);

    // An audio file for a photo task, a PDF, and anything at all for a written task.
    expect((await put(headers, id, "3", mp4Recording(3))).status).toBe(415);
    expect((await put(headers, id, "3", Buffer.from("%PDF-1.7 synthetic", "latin1"))).status).toBe(415);
    expect((await put(headers, id, "1", PNG)).status).toBe(404);
    expect((await get(headers, id, "3")).body.length).toBe(TEN_MB);
  });

  it("takes a recording up to 5 minutes and refuses a longer one, whatever the container", async () => {
    const { id, headers } = await studentWithHomework("Голос");
    expect(await put(headers, id, "2", webmRecording(1.5), { "Content-Type": "audio/webm;codecs=opus" })).toEqual({
      status: 200,
      body: { url: `/api/files/answers/${id}/2`, contentType: "audio/webm" },
    });
    expect((await put(headers, id, "2", webmRecording(300))).status).toBe(200);
    expect((await put(headers, id, "2", fragmentedMp4Recording(290))).status).toBe(200);

    for (const longer of [webmRecording(5 * 60 + 5), mp4Recording(6 * 60), fragmentedMp4Recording(10 * 60)]) {
      const refused = await put(headers, id, "2", longer);
      expect(refused.status).toBe(413);
      expect(refused.body?.error).toContain("5 минут");
    }
    // A photo is not a recording.
    expect((await put(headers, id, "2", PNG)).status).toBe(415);
    // The last recording that was taken stays.
    expect((await get(headers, id, "2")).type).toBe("audio/mp4");
  });

  it("is revalidated at its address, so a new recording is never taken from the browser cache", async () => {
    const { id, headers } = await studentWithHomework("Кэш");
    const first = webmRecording(2);
    await put(headers, id, "2", first);
    const served = await get(headers, id, "2");
    expect(served).toMatchObject({ status: 200, cache: "private, no-cache" });
    expect(served.body.equals(first)).toBe(true);
    expect(await get(headers, id, "2", { "If-None-Match": served.etag! })).toMatchObject({ status: 304, etag: served.etag });

    const second = webmRecording(3);
    await put(headers, id, "2", second);
    const replaced = await get(headers, id, "2", { "If-None-Match": served.etag! });
    expect(replaced.status).toBe(200);
    expect(replaced.etag).not.toBe(served.etag);
    expect(replaced.body.equals(second)).toBe(true);
  });

  it("answers byte ranges, which Safari needs to play audio", async () => {
    const { id, headers } = await studentWithHomework("Диапазон");
    const recording = webmRecording(2);
    await put(headers, id, "2", recording);
    const size = recording.length;

    const head = await get(headers, id, "2", { Range: "bytes=0-1" });
    expect(head).toMatchObject({ status: 206, range: `bytes 0-1/${size}` });
    expect(head.body.equals(recording.subarray(0, 2))).toBe(true);
    const tail = await get(headers, id, "2", { Range: "bytes=-4" });
    expect(tail).toMatchObject({ status: 206, range: `bytes ${size - 4}-${size - 1}/${size}` });
    expect(tail.body.equals(recording.subarray(size - 4))).toBe(true);
    expect((await get(headers, id, "2", { Range: `bytes=${size}-` })).status).toBe(416);
  });

  it("counts the open tasks apart in the result and takes no files after submission", async () => {
    const { id, headers, student } = await studentWithHomework("Итог");
    await student.student.homework.saveAnswer({ id, taskIndex: 0, answer: { type: "single_choice", choice: 0 } });
    await student.student.homework.saveAnswer({ id, taskIndex: 1, answer: { type: "written", text: "Done." } });
    await put(headers, id, "2", webmRecording(1));
    await put(headers, id, "3", PNG);

    const result = { correct: 1, wrong: 0, pending: 3 };
    expect(await student.student.homework.submit({ id, idempotencyKey: crypto.randomUUID() })).toEqual(result);
    expect(await student.student.homework.current()).toMatchObject({ id, result });
    expect((await put(headers, id, "3", PNG)).status).toBe(404);
    // After submission the student still opens their own file, and the teacher too.
    expect((await get(headers, id, "3")).status).toBe(200);
    expect((await get(teacherHeaders, id, "2")).type).toBe("audio/webm");
  });
});
