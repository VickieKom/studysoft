import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LINK_SESSION_COOKIE, type LinkRole } from "../../access/links";
import { closeDb, db } from "../../db/client";
import { accessLink } from "../../db/schema";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest } from "../index";

// Taking links back (#21): reissue, "Завершили", coming back.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];

let teacher: ReturnType<typeof createServerCaller>;
let otherTeacher: ReturnType<typeof createServerCaller>;

function routerRequest(path: string, init: RequestInit = {}) {
  return handleRouterRequest(new Request(`${env().APP_URL}/api/trpc/${path}`, init));
}

/** Exchanges a link like its page does; returns the status and the session cookie. */
async function exchange(url: string): Promise<{ status: number; body: string; cookie: string | null }> {
  const response = await routerRequest("links.exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: url.split("#")[1] }),
  });
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith(`${LINK_SESSION_COOKIE}=`));
  return { status: response.status, body: await response.text(), cookie: cookie ? cookie.split(";")[0]! : null };
}

const as = (cookie: string) => createServerCaller(new Headers({ cookie }));
const link = async (studentId: string, role: LinkRole) => (await teacher.teacher.links[role]({ studentId })).url;

async function newStudent(firstName: string): Promise<string> {
  return (await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" })).id;
}

async function setStatus(id: string, status: "active" | "paused" | "finished") {
  const card = await teacher.teacher.students.get({ id });
  const { lastName, firstName, level, timeZone } = card;
  await teacher.teacher.students.update({ id, firstName, lastName: lastName ?? "", level, timeZone, status });
}

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  otherTeacher = createServerCaller(await signedInHeaders(teacherB));
});

afterAll(closeDb);

describe("reissuing a link", () => {
  it("gives a new link and ends the old one and its sessions, leaving the other role alone", async () => {
    const id = await newStudent("Перевыпуск");
    const oldStudent = await link(id, "student");
    const parent = await link(id, "parent");
    const { cookie: studentSession } = await exchange(oldStudent);
    const { cookie: parentSession } = await exchange(parent);

    await teacher.teacher.links.reissue({ studentId: id, role: "student" });

    const newStudentLink = await link(id, "student");
    expect(newStudentLink).not.toBe(oldStudent);
    expect(await link(id, "student")).toBe(newStudentLink);
    expect((await exchange(oldStudent)).status).toBe(404);
    await expect(as(studentSession!).student.me()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect((await exchange(newStudentLink)).cookie).not.toBeNull();

    expect(await link(id, "parent")).toBe(parent);
    expect(await as(parentSession!).parent.me()).toEqual({ firstName: "Перевыпуск" });
  });

  it("answers a revoked token exactly like a random one", async () => {
    const id = await newStudent("Одинаково");
    const old = await link(id, "parent");
    await teacher.teacher.links.reissue({ studentId: id, role: "parent" });

    const revoked = await exchange(old);
    const random = await exchange(`x#${"x".repeat(43)}`);
    expect(revoked).toEqual(random);
    expect(revoked.cookie).toBeNull();
  });

  it("is not available for another teacher's student", async () => {
    const id = await newStudent("Чужой");
    const before = await link(id, "student");
    await expect(otherTeacher.teacher.links.reissue({ studentId: id, role: "student" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await link(id, "student")).toBe(before);
  });
});

describe("«Завершили»", () => {
  it("closes both links and their sessions; coming back gives new links and the old ones stay closed", async () => {
    const id = await newStudent("Закрытие");
    const oldStudent = await link(id, "student");
    const oldParent = await link(id, "parent");
    const { cookie: studentSession } = await exchange(oldStudent);
    const { cookie: parentSession } = await exchange(oldParent);

    await setStatus(id, "finished");
    expect((await exchange(oldStudent)).status).toBe(404);
    expect((await exchange(oldParent)).status).toBe(404);
    await expect(as(studentSession!).student.me()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(as(parentSession!).parent.me()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    // The card offers no link while the student is there.
    await expect(link(id, "student")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(teacher.teacher.links.reissue({ studentId: id, role: "parent" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });

    await setStatus(id, "active");
    const newStudentLink = await link(id, "student");
    const newParent = await link(id, "parent");
    expect(newStudentLink).not.toBe(oldStudent);
    expect(newParent).not.toBe(oldParent);
    expect((await exchange(newStudentLink)).cookie).not.toBeNull();
    expect((await exchange(newParent)).cookie).not.toBeNull();
    expect((await exchange(oldStudent)).status).toBe(404);
    expect((await exchange(oldParent)).status).toBe(404);
    await expect(as(studentSession!).student.me()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("revokes at once, before the next copy", async () => {
    const id = await newStudent("Сразу");
    await link(id, "student");
    await setStatus(id, "finished");
    const rows = await db()
      .select({ revokedAt: accessLink.revokedAt })
      .from(accessLink)
      .where(eq(accessLink.studentId, id));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.revokedAt !== null)).toBe(true);
  });

  it("«На паузе» does not affect access", async () => {
    const id = await newStudent("Пауза");
    const url = await link(id, "student");
    const { cookie } = await exchange(url);
    await setStatus(id, "paused");
    expect(await link(id, "student")).toBe(url);
    expect(await as(cookie!).student.me()).toEqual({ firstName: "Пауза" });
  });
});
