import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { closeDb } from "../../db/client";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest } from "../index";

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];

let teacher: ReturnType<typeof createServerCaller>;
let otherTeacher: ReturnType<typeof createServerCaller>;
let studentId: string;

const LAST_NAME = "Родительская-Фамилия";

function routerRequest(path: string, init: RequestInit = {}) {
  return handleRouterRequest(new Request(`${env().APP_URL}/api/trpc/${path}`, init));
}

/** Opens a link like its page does; returns the session cookie or null. */
async function exchange(url: string): Promise<string | null> {
  const response = await routerRequest("links.exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: url.split("#")[1] }),
  });
  const cookie = response.headers.getSetCookie().find((value) => Object.values(LINK_SESSION_COOKIES).some((name) => value.startsWith(`${name}=`)));
  return response.ok && cookie ? cookie.split(";")[0]! : null;
}

const as = (cookie: string) => createServerCaller(new Headers({ cookie }));

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  otherTeacher = createServerCaller(await signedInHeaders(teacherB));
  ({ id: studentId } = await teacher.teacher.students.create({
    firstName: "Родитель",
    lastName: LAST_NAME,
    level: "A2",
    timeZone: "Europe/Moscow",
  }));
});

afterAll(closeDb);

describe("parent link", () => {
  it("is its own permanent link, under /p and different from the student's", async () => {
    const parent = (await teacher.teacher.links.parent({ studentId })).url;
    const student = (await teacher.teacher.links.student({ studentId })).url;
    expect(await teacher.teacher.links.parent({ studentId })).toEqual({ url: parent });
    expect(parent).toMatch(new RegExp(`^${env().APP_URL}/p#[A-Za-z0-9_-]{43}$`));
    expect(parent.split("#")[1]).not.toBe(student.split("#")[1]);
  });

  it("is not available to another teacher", async () => {
    await expect(otherTeacher.teacher.links.parent({ studentId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("opens a session that shows the child's first name and never the last name", async () => {
    const cookie = await exchange((await teacher.teacher.links.parent({ studentId })).url);
    expect(cookie).not.toBeNull();
    expect(await as(cookie!).parent.me()).toEqual({ firstName: "Родитель" });

    const raw = await (await routerRequest("parent.me", { headers: { cookie: cookie! } })).text();
    expect(raw).toContain("Родитель");
    expect(raw).not.toContain(LAST_NAME);
    expect(raw).not.toContain("lastName");
  });

  it("keeps parent, student and teacher sessions apart", async () => {
    const parentCookie = await exchange((await teacher.teacher.links.parent({ studentId })).url);
    const studentCookie = await exchange((await teacher.teacher.links.student({ studentId })).url);

    await expect(as(parentCookie!).student.me()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(as(parentCookie!).teacher.students.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(as(studentCookie!).parent.me()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(teacher.parent.me()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("keeps both sessions on one shared device", async () => {
    const studentCookie = await exchange((await teacher.teacher.links.student({ studentId })).url);
    const parentCookie = await exchange((await teacher.teacher.links.parent({ studentId })).url);
    expect(studentCookie!.split("=")[0]).not.toBe(parentCookie!.split("=")[0]);

    // One cookie jar holds both: neither session pushes the other out.
    const device = as(`${studentCookie}; ${parentCookie}`);
    expect(await device.student.me()).toEqual({ firstName: "Родитель" });
    expect(await device.parent.me()).toEqual({ firstName: "Родитель" });
  });

  it("does not accept one role's session under the other role's cookie", async () => {
    const studentCookie = await exchange((await teacher.teacher.links.student({ studentId })).url);
    const value = studentCookie!.split("=").slice(1).join("=");
    await expect(as(`${LINK_SESSION_COOKIES.parent}=${value}`).parent.me()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
