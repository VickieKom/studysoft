import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "../../db/client";
import { clientRequest } from "../../db/schema";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller } from "../index";

// «Привлечение клиентов» (#337): requests by stage, moved by hand to any
// stage, «Отказ» with a reason; «Удалить заявку» erases the personal data and
// keeps an anonymous count. Names and contacts are synthetic.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;
let other: ReturnType<typeof createServerCaller>;

const today = new Date().toISOString().slice(0, 10);
const avito = (firstName: string) => ({ firstName, age: 9, schoolYear: "3", contact: "+7 900 000-00-02", source: "avito" as const, requestedOn: today });
const listed = async (id: string) => (await teacher.teacher.requests.list()).requests.find((r) => r.id === id);

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  other = createServerCaller(await signedInHeaders(teacherB));
});

afterAll(closeDb);

describe("a request", () => {
  it("is added under «Заявка» with its fields; the first name is required, the rest optional", async () => {
    const { id } = await teacher.teacher.requests.create(avito("  Заявкина  "));
    expect(await listed(id)).toEqual({ id, ...avito("Заявкина"), stage: "request", declineReason: null, declineComment: null });

    const { id: bare } = await teacher.teacher.requests.create({ firstName: "Безконтактный", age: null, schoolYear: "", contact: " ", source: "profi", requestedOn: today });
    expect(await listed(bare)).toMatchObject({ age: null, schoolYear: null, contact: null, source: "profi" });

    await expect(teacher.teacher.requests.create({ ...avito("  "), firstName: "  " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await teacher.teacher.requests.list()).today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("moves to any stage and back; «Отказ» keeps its reason and comment, and leaving it clears them", async () => {
    const { id } = await teacher.teacher.requests.create(avito("Движущаяся"));
    await teacher.teacher.requests.move({ id, stage: "offer_sent" });
    await teacher.teacher.requests.move({ id, stage: "intro_booked" });
    expect((await listed(id))!.stage).toBe("intro_booked");

    await teacher.teacher.requests.move({ id, stage: "declined", reason: "expensive", comment: "  Вернутся весной " });
    expect(await listed(id)).toMatchObject({ stage: "declined", declineReason: "expensive", declineComment: "Вернутся весной" });

    await teacher.teacher.requests.move({ id, stage: "request" });
    expect(await listed(id)).toMatchObject({ stage: "request", declineReason: null, declineComment: null });

    // «Отказ» without a reason is refused.
    await expect(teacher.teacher.requests.move({ id, stage: "declined" } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("is another teacher's to no one: not listed, not moved, not deleted", async () => {
    const { id } = await teacher.teacher.requests.create(avito("Чужая"));
    expect((await other.teacher.requests.list()).requests.map((r) => r.id)).not.toContain(id);
    await expect(other.teacher.requests.move({ id, stage: "intro_held" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.teacher.requests.remove({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listed(id))!.stage).toBe("request");
  });

  it("deleted, loses its name, age, school year, contact and comment, and stays only as an anonymous count", async () => {
    const { id } = await teacher.teacher.requests.create(avito("Удаляемая"));
    await teacher.teacher.requests.move({ id, stage: "declined", reason: "no_answer", comment: "Не берёт трубку" });
    await teacher.teacher.requests.remove({ id });
    expect(await listed(id)).toBeUndefined();

    const [row] = await db().select().from(clientRequest).where(eq(clientRequest.id, id));
    expect(row).toMatchObject({
      firstName: null,
      age: null,
      schoolYear: null,
      contact: null,
      declineComment: null,
      source: "avito",
      stage: "declined",
      declineReason: "no_answer",
      requestedOn: today,
    });
    expect(row!.deletedAt).not.toBeNull();
    expect(JSON.stringify(row)).not.toMatch(/Удаляемая|900 000|трубку/);

    // Gone for good: neither moved nor deleted again.
    await expect(teacher.teacher.requests.move({ id, stage: "request" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(teacher.teacher.requests.remove({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
