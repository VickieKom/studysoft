import { afterAll, beforeAll, describe, expect, it } from "vitest";
import allTypes from "../../../../../deploy/seed/homework/demo-all-types.json";
import editor from "../../../../../deploy/seed/homework/demo-editor.json";
import short from "../../../../../deploy/seed/homework/demo-short.json";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { closeDb } from "../../db/client";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest } from "../index";

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];

let teacher: ReturnType<typeof createServerCaller>;
let otherTeacher: ReturnType<typeof createServerCaller>;
let studentId: string;
let studentCookie: string;

const json = (value: unknown) => JSON.stringify(value);
const today = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function routerRequest(path: string, init: RequestInit = {}) {
  return handleRouterRequest(new Request(`${env().APP_URL}/api/trpc/${path}`, init));
}

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  otherTeacher = createServerCaller(await signedInHeaders(teacherB));
  ({ id: studentId } = await teacher.teacher.students.create({
    firstName: "Домашка",
    lastName: "",
    level: "A2",
    timeZone: "Europe/Moscow",
  }));
  const token = (await teacher.teacher.links.student({ studentId })).url.split("#")[1]!;
  const response = await routerRequest("links.exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: json({ token }),
  });
  studentCookie = response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES.student}=`))!.split(";")[0]!;
});

afterAll(closeDb);

describe("teacher.homework", () => {
  it("imports a valid homework as a draft and previews it with the keys for the teacher", async () => {
    const { id } = await teacher.teacher.homework.import({ studentId, json: json(allTypes) });
    const preview = await teacher.teacher.homework.get({ id });
    expect(preview).toMatchObject({ title: allTypes.title, status: "draft", dueDate: null, taskCount: 8 });
    expect(preview.tasks.map((t) => t.prompt)).toEqual(allTypes.tasks.map((t) => t.prompt));
    expect(preview.tasks).toEqual(allTypes.tasks);
  });

  it("refuses an invalid homework with a message naming the task and the field, and saves nothing", async () => {
    const before = (await teacher.teacher.homework.list({ studentId })).length;
    const broken = structuredClone(allTypes);
    (broken.tasks[1] as { type: string }).type = "riddle";
    await expect(teacher.teacher.homework.import({ studentId, json: json(broken) })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/^Задание 2, поле type/),
    });
    await expect(teacher.teacher.homework.import({ studentId, json: "{ nope" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(await teacher.teacher.homework.list({ studentId })).toHaveLength(before);
  });

  it("publishes with a deadline, closes the previous one as missed, and shows only the current one to the student", async () => {
    const student = createServerCaller(new Headers({ cookie: studentCookie }));
    const { id: first } = await teacher.teacher.homework.import({ studentId, json: json(allTypes) });
    await teacher.teacher.homework.publish({ id: first, dueDate: today(2) });
    expect(await student.student.homework.current()).toMatchObject({ dueDate: today(2), taskCount: 8, result: null });

    const { id: second } = await teacher.teacher.homework.import({ studentId, json: json(short) });
    await teacher.teacher.homework.publish({ id: second, dueDate: today(5) });

    const list = await teacher.teacher.homework.list({ studentId });
    expect(list.find((h) => h.id === first)?.status).toBe("missed");
    expect(list.find((h) => h.id === second)?.status).toBe("published");
    expect(await student.student.homework.current()).toMatchObject({ id: second, dueDate: today(5), taskCount: 2, result: null });

    // Only a draft can be published.
    await expect(teacher.teacher.homework.publish({ id: first, dueDate: today(3) })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("never sends a key to the student", async () => {
    const { id } = await teacher.teacher.homework.import({ studentId, json: json(allTypes) });
    await teacher.teacher.homework.publish({ id, dueDate: today(1) });
    const raw = await (await routerRequest("student.homework.current", { headers: { cookie: studentCookie } })).text();
    expect(raw).toContain("taskCount");
    expect(raw).not.toContain("carrots");
    expect(raw).not.toMatch(/answer|pairs|options|prompt/);
  });

  it("takes a published homework back to a draft", async () => {
    const student = createServerCaller(new Headers({ cookie: studentCookie }));
    const { id } = await teacher.teacher.homework.import({ studentId, json: json(short) });
    await teacher.teacher.homework.publish({ id, dueDate: today(3) });
    await teacher.teacher.homework.unpublish({ id });

    expect((await teacher.teacher.homework.get({ id })).status).toBe("draft");
    expect(await student.student.homework.current()).toBeNull();
    await expect(teacher.teacher.homework.unpublish({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("treats another teacher's student and homework like missing ones", async () => {
    const { id } = await teacher.teacher.homework.import({ studentId, json: json(short) });
    const missing = "00000000-0000-4000-8000-000000000000";
    for (const target of [studentId, missing]) {
      await expect(otherTeacher.teacher.homework.list({ studentId: target })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(otherTeacher.teacher.homework.import({ studentId: target, json: json(short) })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    }
    for (const target of [id, missing]) {
      await expect(otherTeacher.teacher.homework.get({ id: target })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(otherTeacher.teacher.homework.publish({ id: target, dueDate: today(1) })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(otherTeacher.teacher.homework.unpublish({ id: target })).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });
});

describe("teacher.homework.updateTasks", () => {
  it("saves edited, added, removed and reordered tasks of a draft", async () => {
    const { id } = await teacher.teacher.homework.import({ studentId, json: json(editor) });
    const [gap, , written] = editor.tasks;
    const added = { type: "single_choice", prompt: "Pick a colour.", options: ["blue", "table"], answer: 0 };
    const fixed = { ...gap, prompt: "Fill in the gap.", answers: [["is", "'s"]] };

    const { tasks } = await teacher.teacher.homework.updateTasks({ id, tasks: [fixed, added, written] });
    expect(tasks.map((t) => t.prompt)).toEqual(["Fill in the gap.", "Pick a colour.", "Write about your pet."]);
    const preview = await teacher.teacher.homework.get({ id });
    expect(preview.tasks).toEqual([fixed, added, written]);
    expect(preview.taskCount).toBe(3);
  });

  it("refuses an invalid list with a message naming the task and the field, and keeps the draft", async () => {
    const { id } = await teacher.teacher.homework.import({ studentId, json: json(editor) });
    const noKey = { ...editor.tasks[0], answers: [[]] };
    await expect(teacher.teacher.homework.updateTasks({ id, tasks: [noKey] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/^Задание 1, поле answers/),
    });
    await expect(teacher.teacher.homework.updateTasks({ id, tasks: [] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await teacher.teacher.homework.get({ id })).tasks).toEqual(editor.tasks);
  });

  it("changes only this teacher's drafts", async () => {
    const { id } = await teacher.teacher.homework.import({ studentId, json: json(editor) });
    await expect(otherTeacher.teacher.homework.updateTasks({ id, tasks: editor.tasks })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await teacher.teacher.homework.publish({ id, dueDate: today(2) });
    await expect(teacher.teacher.homework.updateTasks({ id, tasks: editor.tasks.slice(1) })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect((await teacher.teacher.homework.get({ id })).tasks).toEqual(editor.tasks);
  });

  it("checks the student's answer against the edited key", async () => {
    const student = createServerCaller(new Headers({ cookie: studentCookie }));
    const { id } = await teacher.teacher.homework.import({ studentId, json: json(editor) });
    const [gap, ...rest] = editor.tasks;
    await teacher.teacher.homework.updateTasks({ id, tasks: [{ ...gap, answers: [["is", "'s"]] }, ...rest] });
    await teacher.teacher.homework.publish({ id, dueDate: today(1) });
    await student.student.homework.saveAnswer({ id, taskIndex: 0, answer: { type: "gap", gaps: ["’s"] } });
    expect(await student.student.homework.submit({ id, idempotencyKey: crypto.randomUUID() })).toEqual({
      correct: 1,
      wrong: 1,
    });
  });
});
