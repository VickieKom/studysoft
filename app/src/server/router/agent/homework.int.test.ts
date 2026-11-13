import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import allTypes from "../../../../../deploy/seed/homework/demo-all-types.json";
import short from "../../../../../deploy/seed/homework/demo-short.json";
import { closeDb, db } from "../../db/client";
import { draftOrigin } from "../../db/schema";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller } from "../index";

// The assistant's homework drafts (#43).

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];

let teacher: ReturnType<typeof createServerCaller>;
let otherTeacher: ReturnType<typeof createServerCaller>;
let assistant: ReturnType<typeof createServerCaller>;

const titled = <T extends { title: string }>(homework: T, title: string): T => ({ ...structuredClone(homework), title });
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function newStudent(firstName: string) {
  return (
    await teacher.teacher.students.create({ firstName, lastName: "Скрытая", level: "A2", timeZone: "Europe/Moscow" })
  ).id;
}

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  otherTeacher = createServerCaller(await signedInHeaders(teacherB));
  const { token } = await teacher.teacher.assistant.createToken();
  assistant = createServerCaller(new Headers({ authorization: `Bearer ${token}` }));
});

afterAll(closeDb);

describe("agent homework drafts", () => {
  it("give the format with its version", async () => {
    const format = await assistant.agent.homeworkFormat();
    expect(format.version).toBe(1);
    expect(format.description).toMatch(/^# Homework format, version 1/);
  });

  it("save a draft «от ассистента» with the student context, replace it while untouched, and read it back", async () => {
    const studentId = await newStudent("Ассистент");
    const first = await assistant.agent.saveHomeworkDraft({ studentId, homework: titled(short, "First") });
    let list = await teacher.teacher.homework.list({ studentId });
    expect(list).toEqual([expect.objectContaining({ id: first.id, status: "draft", fromAssistant: true })]);

    const [origin] = await db().select().from(draftOrigin).where(eq(draftOrigin.homeworkId, first.id));
    expect(origin).toMatchObject({ createdBy: "agent", teacherEditedAt: null });
    expect(origin!.context).toMatchObject({ firstName: "Ассистент" });
    expect(JSON.stringify(origin!.context)).not.toContain("Скрытая");

    const second = await assistant.agent.saveHomeworkDraft({ studentId, homework: titled(allTypes, "Second") });
    expect(second.id).toBe(first.id);
    list = await teacher.teacher.homework.list({ studentId });
    expect(list.map((h) => h.title)).toEqual(["Second"]);
    expect(await assistant.agent.readHomeworkDraft({ studentId })).toEqual({
      id: first.id,
      homework: titled(allTypes, "Second"),
    });
  });

  it("make a new draft once the teacher has edited hers, and keep her version", async () => {
    const studentId = await newStudent("Правка");
    const { id } = await assistant.agent.saveHomeworkDraft({ studentId, homework: titled(short, "Hers") });
    const edited = { ...short.tasks[0], prompt: "Edited by the teacher." };
    await teacher.teacher.homework.updateTasks({ id, tasks: [edited, ...short.tasks.slice(1)] });

    const next = await assistant.agent.saveHomeworkDraft({ studentId, homework: titled(short, "Next") });
    expect(next.id).not.toBe(id);
    expect((await teacher.teacher.homework.get({ id })).tasks[0]!.prompt).toBe("Edited by the teacher.");
    expect((await teacher.teacher.homework.list({ studentId })).map((h) => h.title).sort()).toEqual(["Hers", "Next"]);
  });

  it("make a new draft once the old one is published, and never publish", async () => {
    const studentId = await newStudent("Публикация");
    const { id } = await assistant.agent.saveHomeworkDraft({ studentId, homework: titled(short, "Published") });
    await expect(assistant.teacher.homework.publish({ id, dueDate: inDays(2) })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await teacher.teacher.homework.publish({ id, dueDate: inDays(2) });
    const next = await assistant.agent.saveHomeworkDraft({ studentId, homework: titled(short, "After") });
    expect(next.id).not.toBe(id);
    expect((await teacher.teacher.homework.get({ id })).title).toBe("Published");
  });

  it("refuse an invalid homework naming the task and the field, and save nothing", async () => {
    const studentId = await newStudent("Ошибка");
    const broken = structuredClone(allTypes);
    (broken.tasks[1] as { type: string }).type = "riddle";
    await expect(assistant.agent.saveHomeworkDraft({ studentId, homework: broken })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/^Задание 2, поле type/),
    });
    await expect(assistant.agent.saveHomeworkDraft({ studentId, homework: "not a homework" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(await teacher.teacher.homework.list({ studentId })).toEqual([]);
  });

  it("refuse a stored picture of another homework", async () => {
    const studentId = await newStudent("Чужая картинка");
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const { id } = await teacher.teacher.homework.import({
      studentId,
      json: JSON.stringify({ ...short, tasks: [{ ...short.tasks[0], image: png }, ...short.tasks.slice(1)] }),
    });
    const stored = (await teacher.teacher.homework.get({ id })).tasks[0]!.image;
    await expect(
      assistant.agent.saveHomeworkDraft({
        studentId,
        homework: { ...short, tasks: [{ ...short.tasks[0], image: stored }, ...short.tasks.slice(1)] },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/^Задание 1, поле image/) });
  });

  it("treat another teacher's student like a missing one", async () => {
    const foreign = (await otherTeacher.teacher.students.list())[0]!.id;
    for (const studentId of [foreign, "00000000-0000-4000-8000-000000000000"]) {
      await expect(assistant.agent.saveHomeworkDraft({ studentId, homework: short })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(assistant.agent.readHomeworkDraft({ studentId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });
});
