import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pictures from "../../../../../deploy/seed/homework/demo-picture-options.json";
import type { HomeworkDocument } from "../../../domain/homework-format";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { removeUnreferencedBlobs } from "../../blob/store";
import { closeDb, db } from "../../db/client";
import { blob, homework } from "../../db/schema";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleHomeworkImageRequest, handleRouterRequest } from "../index";

// Pictures as answer options (#129): checked at import, kept once, served by
// their position to the teacher and to the student of the published homework,
// the same 404 to anyone else; the student gets addresses, never the stored
// files or the key. The homework and its pictures are synthetic
// (deploy/seed/homework/demo-picture-options.json): task 1 is a red picture
// (right), a green one with a caption and text; task 2 is text and two
// pictures (right), the second of which is the red one again.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];

let teacher: ReturnType<typeof createServerCaller>;
let teacherHeaders: Headers;
let otherTeacherHeaders: Headers;

const json = (value: unknown) => JSON.stringify(value);
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
type Options = { options: (string | { images: string[]; text?: string })[] };

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

const fetchPicture = async (headers: Headers, homeworkId: string, task: string, picture: string) => {
  const request = new Request(`${env().APP_URL}/api/files/homework/${homeworkId}/${task}/pictures/${picture}`, { headers });
  const response = await handleHomeworkImageRequest(request, homeworkId, task, { picture });
  return { status: response.status, type: response.headers.get("Content-Type"), body: Buffer.from(await response.arrayBuffer()) };
};
const bytesOf = (dataUrl: string) => Buffer.from(dataUrl.split(",")[1]!, "base64");

beforeAll(async () => {
  teacherHeaders = await signedInHeaders(teacherA);
  teacher = createServerCaller(teacherHeaders);
  otherTeacherHeaders = await signedInHeaders(teacherB);
});

afterAll(closeDb);

describe("pictures as answer options", () => {
  it("are stored once, served by position to the teacher and the student, and reach the student as addresses", async () => {
    const { studentId, headers } = await newStudent("Варианты-картинки");
    const { id } = await teacher.teacher.homework.import({ studentId, json: json(pictures) });
    const [row] = await db().select({ document: homework.document }).from(homework).where(eq(homework.id, id));
    const [first, second] = (row!.document as HomeworkDocument).tasks as unknown as [Options, Options];
    const red = first.options[0] as { images: string[] };
    expect(red.images[0]).toMatch(/^blob:/);
    // The red picture of task 2 is the same file as task 1's.
    expect((second.options[1] as { images: string[] }).images[1]).toBe(red.images[0]);
    const source = pictures.tasks[0]!.options[0] as { images: string[] };

    expect(await fetchPicture(teacherHeaders, id, "0", "0")).toEqual({ status: 200, type: "image/png", body: bytesOf(source.images[0]!) });
    const missing = await fetchPicture(headers, "00000000-0000-4000-8000-000000000000", "0", "0");
    expect(missing.status).toBe(404);
    // A draft: nothing for the student yet.
    expect(await fetchPicture(headers, id, "0", "0")).toEqual(missing);
    const { revision } = await teacher.teacher.homework.get({ id });
    await teacher.teacher.homework.publish({ id, revision, dueDate: inDays(3) });
    expect((await fetchPicture(headers, id, "1", "1")).body).toEqual(bytesOf(source.images[0]!));
    // A position with no picture, another student and another teacher: the same 404.
    expect(await fetchPicture(headers, id, "0", "2")).toEqual(missing);
    expect(await fetchPicture(headers, id, "0", "x")).toEqual(missing);
    expect(await fetchPicture((await newStudent("Чужие картинки")).headers, id, "0", "0")).toEqual(missing);
    expect(await fetchPicture(otherTeacherHeaders, id, "0", "0")).toEqual(missing);

    const opened = await createServerCaller(headers).student.homework.open({ id });
    expect(opened.tasks[0]).toMatchObject({
      options: [
        { images: [`/api/files/homework/${id}/0/pictures/0`] },
        { images: [`/api/files/homework/${id}/0/pictures/1`], text: "green square" },
        "no colour",
      ],
    });
    expect(opened.tasks[0]).not.toHaveProperty("answer");
    expect(json(opened)).not.toMatch(/blob:|data:image|"answer":/);

    // Checked by its index, as before.
    const student = createServerCaller(headers);
    await student.student.homework.saveAnswer({ id, taskIndex: 0, answer: { type: "single_choice", choice: 0 } });
    await student.student.homework.saveAnswer({ id, taskIndex: 1, answer: { type: "single_choice", choice: 0 } });
    expect(await student.student.homework.submit({ id, idempotencyKey: crypto.randomUUID() })).toEqual({ correct: 1, wrong: 1, pending: 0 });
    const submissionId = (await teacher.teacher.review.list({ studentId }))[0]!.submissionId!;
    const [, reviewed] = (await teacher.teacher.review.get({ id: submissionId })).tasks;
    expect(reviewed).toMatchObject({
      answer: "one square",
      key: "two squares (картинка b)",
      pictureOptions: [
        { images: [], text: "one square", chosen: true, right: false },
        { images: [`/api/files/homework/${id}/1/pictures/0`, `/api/files/homework/${id}/1/pictures/1`], chosen: false, right: true },
      ],
    });

    // The cleanup keeps a picture an option refers to, however old.
    const kept = red.images[0]!.slice(5);
    await db().update(blob).set({ createdAt: new Date(Date.now() - 48 * 3_600_000) }).where(eq(blob.id, kept));
    await removeUnreferencedBlobs(db());
    expect(await db().select().from(blob).where(eq(blob.id, kept))).toHaveLength(1);
  });

  it("refuse a lying picture and a stored reference from elsewhere, naming the option, and save nothing", async () => {
    const { studentId } = await newStudent("Не та картинка");
    const fake = `data:image/png;base64,${Buffer.from("not a picture").toString("base64")}`;
    const cases: [string, RegExp][] = [
      [fake, /^Задание 1, вариант 2, картинка 1: это не картинка PNG/],
      [`blob:${crypto.randomUUID()}`, /^Задание 1, вариант 2, картинка 1: вставьте картинку/],
    ];
    for (const [picture, message] of cases) {
      const document = { version: 1, title: "t", tasks: [{ type: "single_choice", prompt: "p", options: ["a", { images: [picture] }], answer: 0 }] };
      await expect(teacher.teacher.homework.import({ studentId, json: json(document) })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringMatching(message),
      });
    }
    expect(await teacher.teacher.homework.list({ studentId })).toEqual([]);
  });
});
