import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { closeDb, db } from "../../db/client";
import { student, teacher as teacherTable } from "../../db/schema";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest } from "../index";

// A game made for students (#292): marked for some of the teacher's
// students, found by each, named on its page, changed by an edit; an
// archived student keeps the mark, a deleted one loses it; another teacher's
// student is not found. The assistant marks its draft the same way and reads
// a student's games in the context. The student never sees the mark. The
// students and games are synthetic.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;
let assistant: ReturnType<typeof createServerCaller>;

const run = crypto.randomUUID().slice(0, 8);
const html = (title: string) => `<!doctype html><html><body><h1>${title}</h1></body></html>`;
const tags = (title: string) => ({ title, level: "A2" as const, topic: "", ageGroup: "younger" as const });

async function newStudent(firstName: string) {
  return (await teacher.teacher.students.create({ firstName: `${firstName} ${run}`, lastName: "", level: "A2", timeZone: "Europe/Moscow" })).id;
}

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  assistant = createServerCaller(new Headers({ authorization: `Bearer ${(await teacher.teacher.assistant.createToken()).token}` }));
});

afterAll(closeDb);

describe("a game made for students", () => {
  it("is found by each of its students, named, changed by an edit, and kept for an archived student only", async () => {
    const [dasha, masha, sasha] = [await newStudent("Даша"), await newStudent("Маша"), await newStudent("Саша")];
    const { id } = await teacher.teacher.library.addGame({ ...tags("Для двоих"), html: html("Для двоих"), studentIds: [masha, dasha] });
    expect((await teacher.teacher.library.get({ id })).students).toEqual([
      { id: dasha, name: `Даша ${run}` },
      { id: masha, name: `Маша ${run}` },
    ]);
    for (const studentId of [dasha, masha]) expect((await teacher.teacher.library.list({ studentId })).materials.map((m) => m.id)).toEqual([id]);
    expect((await teacher.teacher.library.list({ studentId: sasha })).materials).toEqual([]);

    // An edit without students keeps them; with a list, it is the list.
    await teacher.teacher.library.update({ id, ...tags("Для двоих") });
    expect((await teacher.teacher.library.get({ id })).students).toHaveLength(2);
    await teacher.teacher.library.update({ id, ...tags("Для двоих"), studentIds: [masha] });
    expect((await teacher.teacher.library.get({ id })).students.map((s) => s.id)).toEqual([masha]);

    // Finished (out of the active list), the mark stays; deleted, it is gone.
    await db().update(student).set({ status: "finished" }).where(eq(student.id, masha));
    expect((await teacher.teacher.library.get({ id })).students.map((s) => s.id)).toEqual([masha]);
    await db().update(student).set({ deletedAt: new Date() }).where(eq(student.id, masha));
    expect((await teacher.teacher.library.get({ id })).students).toEqual([]);
  });

  it("refuses another teacher's student", async () => {
    // The other teacher's student from the seed: none is made here, other tests count hers.
    const [theirs] = await db()
      .select({ id: student.id })
      .from(student)
      .innerJoin(teacherTable, eq(teacherTable.id, student.teacherId))
      .where(eq(teacherTable.email, teacherB.email))
      .limit(1);
    const own = await newStudent("Свой");
    expect((await teacher.teacher.students.list()).map((s) => s.id)).not.toContain(theirs!.id);
    await expect(teacher.teacher.library.addGame({ ...tags("Чужой"), html: html("x"), studentIds: [own, theirs!.id] })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is marked by the assistant for its draft, and the student context lists it; the student never sees the mark", async () => {
    const studentId = await newStudent("Ассистент");
    const { id } = await assistant.agent.saveGameDraft({ ...tags("Под пробелы"), html: html("Под пробелы"), studentIds: [studentId] });
    expect((await assistant.agent.studentContext({ studentId })).gamesForStudent).toEqual([{ id, title: "Под пробелы" }]);

    await teacher.teacher.library.addToLibrary({ id });
    const { url } = await teacher.teacher.links.student({ studentId });
    const response = await handleRouterRequest(
      new Request(`${env().APP_URL}/api/trpc/links.exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: url.split("#")[1]! }) }),
    );
    const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES.student}=`))!.split(";")[0]!;
    const pupil = createServerCaller(new Headers({ cookie }));
    expect(JSON.stringify([await pupil.student.me(), await pupil.student.games.list()])).not.toContain("Под пробелы");
  });
});
