import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "../../db/client";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller } from "../index";

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];

let a: ReturnType<typeof createServerCaller>;
let b: ReturnType<typeof createServerCaller>;

beforeAll(async () => {
  a = createServerCaller(await signedInHeaders(teacherA));
  b = createServerCaller(await signedInHeaders(teacherB));
});

afterAll(closeDb);

const base = { lastName: "", level: "B1" as const, timeZone: "Europe/Moscow" as const };

describe("teacher.students", () => {
  it("creates a student in «Обсуждение» and stores names exactly as typed", async () => {
    const firstName = "  Ёлка-Мари д’Арк «№1» <b>&amp;</b> Zz9 ";
    const lastName = "Тестова".repeat(30);
    const { id } = await a.teacher.students.create({ ...base, firstName, lastName });

    expect(await a.teacher.students.get({ id })).toEqual({
      id,
      firstName,
      lastName,
      level: "B1",
      timeZone: "Europe/Moscow",
      status: "discussion",
    });
  });

  it("stores an empty last name as none", async () => {
    const { id } = await a.teacher.students.create({ ...base, firstName: "Без фамилии", lastName: "   " });
    expect((await a.teacher.students.get({ id })).lastName).toBeNull();
  });

  it("refuses an empty first name and creates nothing", async () => {
    const before = (await a.teacher.students.list()).length;
    await expect(a.teacher.students.create({ ...base, firstName: "  " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await a.teacher.students.list()).toHaveLength(before);
  });

  it("refuses a level, time zone or status outside the lists", async () => {
    await expect(
      a.teacher.students.create({ ...base, firstName: "x", level: "C2" as never }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      a.teacher.students.create({ ...base, firstName: "x", timeZone: "Mars/Olympus" as never }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("updates every field and hides «Завершили» from the default list", async () => {
    const { id } = await a.teacher.students.create({ ...base, firstName: "Архивная" });
    await a.teacher.students.update({
      id,
      firstName: "Архивная 2",
      lastName: "Тестова",
      level: "C1",
      timeZone: "Asia/Almaty",
      status: "finished",
    });

    expect(await a.teacher.students.get({ id })).toMatchObject({
      firstName: "Архивная 2",
      lastName: "Тестова",
      level: "C1",
      timeZone: "Asia/Almaty",
      status: "finished",
    });
    expect((await a.teacher.students.list()).map((s) => s.id)).not.toContain(id);
    expect((await a.teacher.students.list({ status: "finished" })).map((s) => s.id)).toContain(id);
  });

  it("treats another teacher's student exactly like a missing one", async () => {
    const { id } = await a.teacher.students.create({ ...base, firstName: "Чужая" });
    const missing = "00000000-0000-4000-8000-000000000000";
    const update = { firstName: "Взлом", lastName: "", level: "A1" as const, timeZone: "Europe/Moscow" as const, status: "active" as const };

    for (const target of [id, missing]) {
      await expect(b.teacher.students.get({ id: target })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(b.teacher.students.update({ ...update, id: target })).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect((await b.teacher.students.list()).map((s) => s.id)).not.toContain(id);
    expect((await a.teacher.students.get({ id })).firstName).toBe("Чужая");
  });
});
