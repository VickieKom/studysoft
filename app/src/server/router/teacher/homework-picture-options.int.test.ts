import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import gapPictures from "../../../../../deploy/seed/homework/demo-gap-pictures.json";
import matchPictures from "../../../../../deploy/seed/homework/demo-match-pictures.json";
import pictures from "../../../../../deploy/seed/homework/demo-picture-options.json";
import tableHomework from "../../../../../deploy/seed/homework/demo-table.json";
import type { HomeworkDocument } from "../../../domain/homework-format";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { removeUnreferencedBlobs } from "../../blob/store";
import { closeDb, db } from "../../db/client";
import { blob, homework } from "../../db/schema";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleHomeworkImageRequest, handleRouterRequest } from "../index";

// Pictures as answer options (#129), by gaps (#181), in match pairs (#184) and in a table's header (#186): checked at import, kept once, served by
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

describe("pictures by the gaps", () => {
  it("are stored, served by position, reach the student as addresses, show in the review and stay through an edit", async () => {
    const { studentId, headers } = await newStudent("Картинки у пропусков");
    const { id } = await teacher.teacher.homework.import({ studentId, json: json(gapPictures) });
    const [stored] = (await teacher.teacher.homework.get({ id })).tasks as unknown as [{ gapImages: string[] }];
    expect(stored.gapImages.every((value) => value.startsWith("blob:"))).toBe(true);
    const source = gapPictures.tasks[0]!.gapImages;
    expect((await fetchPicture(teacherHeaders, id, "0", "2")).body).toEqual(bytesOf(source[2]!));

    // The draft editor sends the stored references back: they stay; a count unlike the gaps is refused.
    const [task] = (await teacher.teacher.homework.get({ id })).tasks;
    const revision = (await teacher.teacher.homework.get({ id })).revision;
    const { tasks } = await teacher.teacher.homework.updateTasks({ id, revision, tasks: [{ ...task!, prompt: "Label the squares." }] });
    expect((tasks[0] as unknown as { gapImages: string[] }).gapImages).toEqual(stored.gapImages);
    await expect(
      teacher.teacher.homework.updateTasks({
        id,
        revision: (await teacher.teacher.homework.get({ id })).revision,
        tasks: [{ ...task!, gapImages: stored.gapImages.slice(1) } as typeof task],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/^Задание 1, поле gapImages/) });

    const { revision: current } = await teacher.teacher.homework.get({ id });
    await teacher.teacher.homework.publish({ id, revision: current, dueDate: inDays(3) });
    const student = createServerCaller(headers);
    const opened = await student.student.homework.open({ id });
    expect(opened.tasks[0]).toMatchObject({ gapImages: [0, 1, 2].map((n) => `/api/files/homework/${id}/0/pictures/${n}`) });
    expect(json(opened)).not.toMatch(/blob:|data:image|"answers":\[\["/);
    expect((await fetchPicture(headers, id, "0", "1")).body).toEqual(bytesOf(source[1]!));

    await student.student.homework.saveAnswer({ id, taskIndex: 0, answer: { type: "gap", gaps: ["red", "green", "blue"] } });
    expect(await student.student.homework.submit({ id, idempotencyKey: crypto.randomUUID() })).toEqual({ correct: 1, wrong: 0, pending: 0 });
    const submissionId = (await teacher.teacher.review.list({ studentId }))[0]!.submissionId!;
    expect((await teacher.teacher.review.get({ id: submissionId })).tasks[0]!.gapImages).toEqual(
      [0, 1, 2].map((n) => `/api/files/homework/${id}/0/pictures/${n}`),
    );

    // The cleanup keeps a picture a gap refers to, however old.
    const kept = stored.gapImages[0]!.slice(5);
    await db().update(blob).set({ createdAt: new Date(Date.now() - 48 * 3_600_000) }).where(eq(blob.id, kept));
    await removeUnreferencedBlobs(db());
    expect(await db().select().from(blob).where(eq(blob.id, kept))).toHaveLength(1);
  });
});

describe("pictures to match sentences to", () => {
  it("are stored, served by position, reach the student on the left with no pairing, show in the review and stay", async () => {
    const { studentId, headers } = await newStudent("Картинки в парах");
    const { id } = await teacher.teacher.homework.import({ studentId, json: json(matchPictures) });
    const source = matchPictures.tasks[0]!.pairs.map((p) => p.left.images[0]!);
    expect((await fetchPicture(teacherHeaders, id, "0", "2")).body).toEqual(bytesOf(source[2]!));

    const draft = await teacher.teacher.homework.get({ id });
    const { tasks } = await teacher.teacher.homework.updateTasks({ id, revision: draft.revision, tasks: [{ ...draft.tasks[0]!, prompt: "Match them." }] });
    expect(json(tasks[0])).toBe(json({ ...draft.tasks[0]!, prompt: "Match them." }));

    const { revision } = await teacher.teacher.homework.get({ id });
    await teacher.teacher.homework.publish({ id, revision, dueDate: inDays(3) });
    const student = createServerCaller(headers);
    const opened = await student.student.homework.open({ id });
    expect(opened.tasks[0]).toMatchObject({
      left: ["картинка 1", "картинка 2", "картинка 3"],
      leftImages: [0, 1, 2].map((n) => [`/api/files/homework/${id}/0/pictures/${n}`]),
    });
    const sentences = matchPictures.tasks[0]!.pairs.map((p) => p.right);
    expect(json(opened)).not.toContain(json(sentences));
    expect(json(opened)).not.toMatch(/blob:|data:image/);

    const pairs = sentences.map((right, i) => ({ left: `картинка ${i + 1}`, right }));
    await student.student.homework.saveAnswer({ id, taskIndex: 0, answer: { type: "match", pairs } });
    expect(await student.student.homework.submit({ id, idempotencyKey: crypto.randomUUID() })).toEqual({ correct: 1, wrong: 0, pending: 0 });
    const submissionId = (await teacher.teacher.review.list({ studentId }))[0]!.submissionId!;
    expect((await teacher.teacher.review.get({ id: submissionId })).tasks[0]!.pairImages).toEqual(
      [0, 1, 2].map((n) => [`/api/files/homework/${id}/0/pictures/${n}`]),
    );

    const [row] = await db().select({ document: homework.document }).from(homework).where(eq(homework.id, id));
    const kept = ((row!.document as HomeworkDocument).tasks[0] as unknown as { pairs: { left: { images: string[] } }[] }).pairs[0]!.left.images[0]!.slice(5);
    await db().update(blob).set({ createdAt: new Date(Date.now() - 48 * 3_600_000) }).where(eq(blob.id, kept));
    await removeUnreferencedBlobs(db());
    expect(await db().select().from(blob).where(eq(blob.id, kept))).toHaveLength(1);
  });
});

describe("a table", () => {
  it("is stored, reaches the student without keys, is checked as one task, shows in the review and keeps its pictures", async () => {
    const { studentId, headers } = await newStudent("Таблица с картинками");
    const { id } = await teacher.teacher.homework.import({ studentId, json: json(tableHomework) });
    const source = tableHomework.tasks[0]!.header.flatMap((cell) => (typeof cell === "string" ? [] : cell.images));
    expect((await fetchPicture(teacherHeaders, id, "0", "1")).body).toEqual(bytesOf(source[1]!));

    const draft = await teacher.teacher.homework.get({ id });
    const { tasks } = await teacher.teacher.homework.updateTasks({ id, revision: draft.revision, tasks: [{ ...draft.tasks[0]!, prompt: "Fill in." }] });
    expect(json(tasks[0])).toBe(json({ ...draft.tasks[0]!, prompt: "Fill in." }));

    const { revision } = await teacher.teacher.homework.get({ id });
    await teacher.teacher.homework.publish({ id, revision, dueDate: inDays(3) });
    const student = createServerCaller(headers);
    const opened = await student.student.homework.open({ id });
    expect(opened.tasks[0]).toMatchObject({
      type: "table",
      header: ["", { images: [`/api/files/homework/${id}/0/pictures/0`], text: "Square A" }, { images: [`/api/files/homework/${id}/0/pictures/1`] }],
      rows: [
        ["Is it red?", { blank: "mark" }, { blank: "mark" }],
        ["Is it blue?", "✗", "✓"],
        ["Colour", { blank: "text" }, { blank: "text" }],
      ],
    });
    expect(json(opened)).not.toMatch(/blob:|data:image|"mark":|"gap":|dark blue/);

    // A mark that is neither yes nor no does not fit.
    await expect(student.student.homework.saveAnswer({ id, taskIndex: 0, answer: { type: "table", cells: ["maybe", "no", "red", "blue"] } })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await student.student.homework.saveAnswer({ id, taskIndex: 0, answer: { type: "table", cells: ["yes", "no", "Red", "dark blue"] } });
    expect(await student.student.homework.submit({ id, idempotencyKey: crypto.randomUUID() })).toEqual({ correct: 1, wrong: 0, pending: 0 });
    const submissionId = (await teacher.teacher.review.list({ studentId }))[0]!.submissionId!;
    expect((await teacher.teacher.review.get({ id: submissionId })).tasks[0]).toMatchObject({
      answer: "1.2: ✓; 1.3: ✗; 3.2: Red; 3.3: dark blue",
      key: "1.2: ✓; 1.3: ✗; 3.2: red; 3.3: blue / dark blue",
      headerImages: [null, [`/api/files/homework/${id}/0/pictures/0`], [`/api/files/homework/${id}/0/pictures/1`]],
    });

    const [row] = await db().select({ document: homework.document }).from(homework).where(eq(homework.id, id));
    const kept = ((row!.document as HomeworkDocument).tasks[0] as unknown as { header: { images: string[] }[] }).header[1]!.images[0]!.slice(5);
    await db().update(blob).set({ createdAt: new Date(Date.now() - 48 * 3_600_000) }).where(eq(blob.id, kept));
    await removeUnreferencedBlobs(db());
    expect(await db().select().from(blob).where(eq(blob.id, kept))).toHaveLength(1);
  });
});
