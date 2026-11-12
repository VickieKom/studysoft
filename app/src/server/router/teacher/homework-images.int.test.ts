import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { closeDb } from "../../db/client";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleHomeworkImageRequest, handleRouterRequest } from "../index";

// Pictures in homework tasks (#33). The pictures are synthetic, made here.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];

// A 1×1 PNG and a 1×1 GIF, written for this test.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const GIF_BYTES = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
const dataUrl = (type: string, bytes: Buffer) => `data:${type};base64,${bytes.toString("base64")}`;
const PNG = dataUrl("image/png", PNG_BYTES);

let teacherHeaders: Headers;
let teacher: ReturnType<typeof createServerCaller>;
let otherTeacher: ReturnType<typeof createServerCaller>;

const json = (value: unknown) => JSON.stringify(value);
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

function withImages(images: (string | undefined)[]) {
  return {
    version: 1,
    title: "Pictures",
    tasks: images.map((image, i) => ({
      type: "single_choice",
      prompt: `Task ${i + 1}`,
      options: ["a", "b"],
      answer: 0,
      ...(image ? { image } : {}),
    })),
  };
}

async function student(firstName: string) {
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
  return { studentId, headers: new Headers({ cookie }), caller: createServerCaller(new Headers({ cookie })) };
}

async function fetchImage(headers: Headers, homeworkId: string, taskIndex: string) {
  const response = await handleHomeworkImageRequest(
    new Request(`${env().APP_URL}/api/files/homework/${homeworkId}/${taskIndex}`, { headers }),
    homeworkId,
    taskIndex,
  );
  return { status: response.status, type: response.headers.get("Content-Type"), body: Buffer.from(await response.arrayBuffer()) };
}

async function fetchWithTag(headers: Headers, homeworkId: string, taskIndex: string, ifNoneMatch?: string) {
  const request = new Headers(headers);
  if (ifNoneMatch) request.set("If-None-Match", ifNoneMatch);
  const response = await handleHomeworkImageRequest(
    new Request(`${env().APP_URL}/api/files/homework/${homeworkId}/${taskIndex}`, { headers: request }),
    homeworkId,
    taskIndex,
  );
  return {
    status: response.status,
    etag: response.headers.get("ETag"),
    cache: response.headers.get("Cache-Control"),
    body: Buffer.from(await response.arrayBuffer()),
  };
}

beforeAll(async () => {
  teacherHeaders = await signedInHeaders(teacherA);
  teacher = createServerCaller(teacherHeaders);
  otherTeacher = createServerCaller(await signedInHeaders(teacherB));
});

afterAll(closeDb);

describe("pictures in homework", () => {
  it("are stored on import and served to the teacher, and to the student only in their published homework", async () => {
    const own = await student("Картинка");
    const other = await student("Чужая");
    const { id } = await teacher.teacher.homework.import({ studentId: own.studentId, json: json(withImages([PNG, undefined])) });

    const preview = await teacher.teacher.homework.get({ id });
    expect(preview.tasks[0]!.image).toMatch(/^blob:[0-9a-f-]{36}$/);
    expect(preview.tasks[1]!.image).toBeUndefined();

    const forTeacher = await fetchImage(teacherHeaders, id, "0");
    expect(forTeacher).toMatchObject({ status: 200, type: "image/png" });
    expect(forTeacher.body.equals(PNG_BYTES)).toBe(true);

    const missing = await fetchImage(teacherHeaders, id, "1");
    expect(missing.status).toBe(404);
    // A draft: not even its own student.
    expect(await fetchImage(own.headers, id, "0")).toEqual(missing);

    await teacher.teacher.homework.publish({ id, dueDate: inDays(2) });
    expect((await fetchImage(own.headers, id, "0")).status).toBe(200);
    const opened = await own.caller.student.homework.open({ id });
    expect(opened.tasks[0]!.image).toBe(`/api/files/homework/${id}/0`);
    expect(JSON.stringify(opened)).not.toContain("blob:");

    for (const headers of [new Headers(), other.headers, await signedInHeaders(teacherB)]) {
      expect(await fetchImage(headers, id, "0")).toEqual(missing);
    }
    for (const index of ["0x", "-1", "99", "00"]) expect(await fetchImage(teacherHeaders, id, index)).toEqual(missing);
    expect(await fetchImage(teacherHeaders, "not-a-uuid", "0")).toEqual(missing);
  });

  it("refuses an unsupported, a disguised or an oversized picture, naming the task, and saves nothing", async () => {
    const { studentId } = await student("Отказ");
    const before = (await teacher.teacher.homework.list({ studentId })).length;
    const huge = dataUrl("image/png", Buffer.concat([PNG_BYTES, Buffer.alloc(2 * 1024 * 1024)]));
    const cases: [string, RegExp][] = [
      [dataUrl("image/gif", GIF_BYTES), /^Задание 2, поле image/],
      [dataUrl("image/png", GIF_BYTES), /^Задание 2, поле image/],
      [huge, /^Задание 2, поле image: картинка больше 2 МБ/],
      [`blob:${crypto.randomUUID()}`, /^Задание 2, поле image/],
    ];
    for (const [image, message] of cases) {
      await expect(
        teacher.teacher.homework.import({ studentId, json: json(withImages([PNG, image])) }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(message) });
    }
    expect(await teacher.teacher.homework.list({ studentId })).toHaveLength(before);
  });

  it("keeps a draft's own pictures when editing, takes new ones, and refuses another homework's", async () => {
    const { studentId } = await student("Правка картинок");
    const { id } = await teacher.teacher.homework.import({ studentId, json: json(withImages([PNG])) });
    const { id: otherId } = await teacher.teacher.homework.import({ studentId, json: json(withImages([PNG])) });
    const [kept] = (await teacher.teacher.homework.get({ id })).tasks;
    const [foreign] = (await teacher.teacher.homework.get({ id: otherId })).tasks;

    const { tasks } = await teacher.teacher.homework.updateTasks({
      id,
      tasks: [kept, { ...kept, prompt: "New", image: PNG }],
    });
    expect(tasks[0]!.image).toBe(kept!.image);
    expect(tasks[1]!.image).toMatch(/^blob:/);
    expect(tasks[1]!.image).not.toBe(kept!.image);
    expect((await fetchImage(teacherHeaders, id, "1")).status).toBe(200);

    await expect(teacher.teacher.homework.updateTasks({ id, tasks: [foreign] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/^Задание 1, поле image/),
    });
    await expect(otherTeacher.teacher.homework.updateTasks({ id, tasks: [kept] })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("is revalidated at its address, so a reorder or a replacement shows the new picture", async () => {
    const { studentId } = await student("Порядок картинок");
    // A second picture with other bytes: the same PNG with a byte after its end.
    const other = Buffer.concat([PNG_BYTES, Buffer.from([0x21])]);
    const { id } = await teacher.teacher.homework.import({
      studentId,
      json: json(withImages([PNG, dataUrl("image/png", other)])),
    });

    const first = await fetchWithTag(teacherHeaders, id, "0");
    expect(first).toMatchObject({ status: 200, cache: "private, no-cache" });
    expect(first.body.equals(PNG_BYTES)).toBe(true);
    // An unchanged picture: 304 without the bytes.
    expect(await fetchWithTag(teacherHeaders, id, "0", first.etag!)).toMatchObject({ status: 304, etag: first.etag });

    // «Ниже» on the first task: the same address now has the other picture.
    const [a, b] = (await teacher.teacher.homework.get({ id })).tasks;
    await teacher.teacher.homework.updateTasks({ id, tasks: [b, a] });
    const moved = await fetchWithTag(teacherHeaders, id, "0", first.etag!);
    expect(moved.status).toBe(200);
    expect(moved.etag).not.toBe(first.etag);
    expect(moved.body.equals(other)).toBe(true);
  });
});
