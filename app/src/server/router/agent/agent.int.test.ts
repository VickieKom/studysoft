import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "../../db/client";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller } from "../index";

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];

let teacher: ReturnType<typeof createServerCaller>;
let otherTeacher: ReturnType<typeof createServerCaller>;
let studentId: string;
let foreignStudentId: string;

const agent = (token: string) => createServerCaller(new Headers({ authorization: `Bearer ${token}` }));

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  otherTeacher = createServerCaller(await signedInHeaders(teacherB));
  const base = { level: "B1" as const, timeZone: "Europe/Moscow" as const };
  ({ id: studentId } = await teacher.teacher.students.create({ ...base, firstName: "Контекст", lastName: "Скрытова" }));
  await teacher.teacher.students.update({
    ...base,
    id: studentId,
    firstName: "Контекст",
    lastName: "Скрытова",
    status: "active",
    age: "13",
    schoolYear: "7",
    textbook: "Учебник 2",
    currentUnit: "Unit 4",
    interests: "комиксы",
    whatWorks: "игры",
    gaps: "Past Simple",
  });
  for (let i = 1; i <= 7; i++) await teacher.teacher.notes.add({ studentId, body: `заметка ${i}` });
  // The second teacher's seeded student (deploy/seed/students.json).
  foreignStudentId = (await otherTeacher.teacher.students.list())[0]!.id;
});

afterAll(closeDb);

describe("agent procedures", () => {
  it("refuse a request without a token or with a wrong one", async () => {
    await expect(createServerCaller(new Headers()).agent.listStudents()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(agent("not-a-token").agent.listStudents()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("list the teacher's students with first name and status only", async () => {
    const { token } = await teacher.teacher.assistant.createToken();
    const list = await agent(token).agent.listStudents();
    const entry = list.find((s) => s.id === studentId);
    expect(entry).toEqual({ id: studentId, firstName: "Контекст", status: "active" });
    expect(list.map((s) => s.id)).not.toContain(foreignStudentId);
    expect(JSON.stringify(list)).not.toContain("Скрытова");
  });

  it("give the student context with the profile and the 5 latest notes, newest first", async () => {
    const { token } = await teacher.teacher.assistant.createToken();
    const context = await agent(token).agent.studentContext({ studentId });
    expect(context).toMatchObject({
      firstName: "Контекст",
      age: "13",
      schoolYear: "7",
      level: "B1",
      textbook: "Учебник 2",
      currentUnit: "Unit 4",
      interests: "комиксы",
      whatWorks: "игры",
      gaps: "Past Simple",
    });
    expect(context.notes.map((n) => n.body)).toEqual(["заметка 7", "заметка 6", "заметка 5", "заметка 4", "заметка 3"]);
    expect(Object.keys(context)).not.toContain("lastName");
    expect(JSON.stringify(context)).not.toContain("Скрытова");
  });

  it("answer another teacher's student exactly like a missing one", async () => {
    const { token } = await teacher.teacher.assistant.createToken();
    for (const id of [foreignStudentId, "00000000-0000-4000-8000-000000000000"]) {
      await expect(agent(token).agent.studentContext({ studentId: id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });

  it("keep the token out of teacher procedures", async () => {
    const { token } = await teacher.teacher.assistant.createToken();
    await expect(agent(token).teacher.students.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(agent(token).teacher.assistant.createToken()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("stop the old token when a new one is created, and every token after «Отозвать»", async () => {
    const { token: first } = await teacher.teacher.assistant.createToken();
    const { token: second } = await teacher.teacher.assistant.createToken();
    await expect(agent(first).agent.listStudents()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await agent(second).agent.listStudents();

    await teacher.teacher.assistant.revokeToken();
    await expect(agent(second).agent.listStudents()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(await teacher.teacher.assistant.status()).toBeNull();
  });

  it("record when the token was last used", async () => {
    const { token } = await teacher.teacher.assistant.createToken();
    expect((await teacher.teacher.assistant.status())?.lastUsedAt).toBeNull();
    await agent(token).agent.listStudents();
    expect((await teacher.teacher.assistant.status())?.lastUsedAt).not.toBeNull();
  });
});
