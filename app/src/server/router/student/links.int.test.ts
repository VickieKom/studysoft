import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LINK_SESSION_COOKIE } from "../../access/links";
import { closeDb, db } from "../../db/client";
import { accessLink, linkSession } from "../../db/schema";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest } from "../index";

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];

let teacher: ReturnType<typeof createServerCaller>;
let otherTeacher: ReturnType<typeof createServerCaller>;
let teacherHeaders: Headers;
let studentId: string;

const LAST_NAME = "Скрытая-Фамилия";

function routerRequest(path: string, init: RequestInit = {}) {
  return handleRouterRequest(new Request(`${env().APP_URL}/api/trpc/${path}`, init));
}

/** Opens the link like the student page does; returns the session cookie or null. */
async function exchange(token: string): Promise<string | null> {
  const response = await routerRequest("links.exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith(`${LINK_SESSION_COOKIE}=`));
  return response.ok && cookie ? cookie.split(";")[0]! : null;
}

async function studentLink(): Promise<string> {
  return (await teacher.teacher.links.student({ studentId })).url;
}

beforeAll(async () => {
  teacherHeaders = await signedInHeaders(teacherA);
  teacher = createServerCaller(teacherHeaders);
  otherTeacher = createServerCaller(await signedInHeaders(teacherB));
  ({ id: studentId } = await teacher.teacher.students.create({
    firstName: "Ссылка",
    lastName: LAST_NAME,
    level: "A2",
    timeZone: "Europe/Moscow",
  }));
});

afterAll(closeDb);

describe("student link", () => {
  it("is the same link on every copy, with the token in the fragment", async () => {
    const first = await studentLink();
    expect(await studentLink()).toBe(first);
    expect(first).toMatch(new RegExp(`^${env().APP_URL}/s#[A-Za-z0-9_-]{43}$`));
  });

  it("is not available to another teacher", async () => {
    await expect(otherTeacher.teacher.links.student({ studentId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("stores only a hash of the token", async () => {
    const token = (await studentLink()).split("#")[1]!;
    const [row] = await db().select().from(accessLink).where(eq(accessLink.studentId, studentId));
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("opens a session that shows the first name and never the last name", async () => {
    const cookie = await exchange((await studentLink()).split("#")[1]!);
    expect(cookie).not.toBeNull();

    expect(await createServerCaller(new Headers({ cookie: cookie! })).student.me()).toEqual({ firstName: "Ссылка" });
    const raw = await (await routerRequest("student.me", { headers: { cookie: cookie! } })).text();
    expect(raw).toContain("Ссылка");
    expect(raw).not.toContain(LAST_NAME);
    expect(raw).not.toContain("lastName");
  });

  it("refuses a random token without a cookie", async () => {
    const response = await routerRequest("links.exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "x".repeat(43) }),
    });
    expect(response.status).toBe(404);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("keeps student and teacher sessions apart", async () => {
    await expect(createServerCaller(teacherHeaders).student.me()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const cookie = await exchange((await studentLink()).split("#")[1]!);
    await expect(createServerCaller(new Headers({ cookie: cookie! })).teacher.students.list()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("extends a session on a visit and ends an expired one", async () => {
    const cookie = await exchange((await studentLink()).split("#")[1]!);
    const caller = createServerCaller(new Headers({ cookie: cookie! }));
    const latest = (await db().select().from(linkSession)).sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())[0]!;

    // Last seen two hours ago, expiring tomorrow: a visit pushes the expiry ~90 days out.
    const soon = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db()
      .update(linkSession)
      .set({ lastSeenAt: new Date(Date.now() - 2 * 60 * 60 * 1000), expiresAt: soon })
      .where(eq(linkSession.id, latest.id));
    await caller.student.me();
    const [extended] = await db().select().from(linkSession).where(eq(linkSession.id, latest.id));
    expect(extended!.expiresAt.getTime() - Date.now()).toBeGreaterThan(80 * 24 * 60 * 60 * 1000);

    await db().update(linkSession).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(linkSession.id, latest.id));
    await expect(caller.student.me()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("ends the sessions of an old generation (what a reissue will do)", async () => {
    const cookie = await exchange((await studentLink()).split("#")[1]!);
    const caller = createServerCaller(new Headers({ cookie: cookie! }));
    await caller.student.me();

    const [link] = await db().select().from(accessLink).where(eq(accessLink.studentId, studentId));
    await db().update(accessLink).set({ generation: link!.generation + 1 }).where(eq(accessLink.id, link!.id));
    await expect(caller.student.me()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
