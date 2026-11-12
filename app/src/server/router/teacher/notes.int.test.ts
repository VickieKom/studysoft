import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "../../db/client";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller } from "../index";

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];

let a: ReturnType<typeof createServerCaller>;
let b: ReturnType<typeof createServerCaller>;
let studentId: string;

beforeAll(async () => {
  a = createServerCaller(await signedInHeaders(teacherA));
  b = createServerCaller(await signedInHeaders(teacherB));
  ({ id: studentId } = await a.teacher.students.create({
    firstName: "Заметки",
    lastName: "",
    level: "A2",
    timeZone: "Europe/Moscow",
  }));
});

afterAll(closeDb);

describe("teacher.notes", () => {
  it("adds notes as typed and lists them newest first", async () => {
    const first = await a.teacher.notes.add({ studentId, body: "первая\nстрока <b>2</b>" });
    const second = await a.teacher.notes.add({ studentId, body: "вторая" });

    expect(first.body).toBe("первая\nстрока <b>2</b>");
    expect(Number.isNaN(Date.parse(first.createdAt))).toBe(false);
    expect((await a.teacher.notes.list({ studentId })).map((n) => n.id).slice(0, 2)).toEqual([second.id, first.id]);
  });

  it("refuses an empty note", async () => {
    await expect(a.teacher.notes.add({ studentId, body: "  \n " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("edits and deletes a note", async () => {
    const created = await a.teacher.notes.add({ studentId, body: "до" });
    expect((await a.teacher.notes.update({ id: created.id, body: "после" })).body).toBe("после");

    await a.teacher.notes.delete({ id: created.id });
    expect((await a.teacher.notes.list({ studentId })).map((n) => n.id)).not.toContain(created.id);
  });

  it("keeps another teacher out: the same answer as for something missing", async () => {
    const created = await a.teacher.notes.add({ studentId, body: "секрет" });
    const missing = "00000000-0000-4000-8000-000000000000";

    for (const id of [studentId, missing]) {
      await expect(b.teacher.notes.list({ studentId: id })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(b.teacher.notes.add({ studentId: id, body: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    for (const id of [created.id, missing]) {
      await expect(b.teacher.notes.update({ id, body: "взлом" })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(b.teacher.notes.delete({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect((await a.teacher.notes.list({ studentId })).find((n) => n.id === created.id)?.body).toBe("секрет");
  });
});
