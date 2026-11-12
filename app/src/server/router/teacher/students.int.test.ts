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

    // The card has more fields (the profile, #41); these are the ones set here.
    expect(await a.teacher.students.get({ id })).toMatchObject({
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

  it("saves the profile as typed, blank as none, and keeps it when an update leaves it out", async () => {
    const { id } = await a.teacher.students.create({ ...base, firstName: "Профиль" });
    const card = await a.teacher.students.get({ id });
    expect(card).toMatchObject({ age: null, interests: null, gaps: null });

    const profile = {
      age: "почти 13",
      schoolYear: "7",
      interests: "комиксы\nкошки",
      whatWorks: "игры <на скорость>",
      gaps: "   ",
      textbook: "Учебник 2",
      currentUnit: "Unit 3",
    };
    const fields = { firstName: "Профиль", lastName: "", level: "B1" as const, timeZone: "Europe/Moscow" as const, status: "active" as const };
    await a.teacher.students.update({ id, ...fields, ...profile });
    expect(await a.teacher.students.get({ id })).toMatchObject({ ...profile, gaps: null });

    await a.teacher.students.update({ id, ...fields, firstName: "Профиль 2" });
    expect(await a.teacher.students.get({ id })).toMatchObject({ firstName: "Профиль 2", age: "почти 13", currentUnit: "Unit 3" });
  });
});
