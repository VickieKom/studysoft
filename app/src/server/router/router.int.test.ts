import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "../db/client";
import { authRequest, seedStudents, seedTeachers, signedInHeaders } from "../testing/requests";
import { createServerCaller } from "./index";

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];

// Sign-in attempts are rate limited per client, so each teacher signs in once
// for the whole file and the limit itself is checked last.
let sessionA: Headers;
let sessionB: Headers;

beforeAll(async () => {
  sessionA = await signedInHeaders(teacherA);
  sessionB = await signedInHeaders(teacherB);
});

afterAll(closeDb);

describe("health", () => {
  it("reports a reachable database and the build", async () => {
    const health = await createServerCaller(new Headers()).health.check();
    expect(health).toEqual({ database: "ok", build: expect.any(String) });
  });
});

describe("teacher sign-in", () => {
  it("opens a session that identifies the teacher", async () => {
    const me = await createServerCaller(sessionA).teacher.session.me();
    expect(me).toEqual({ id: expect.any(String), name: teacherA.name });
  });

  it("rejects a wrong password without setting a session", async () => {
    const response = await authRequest("/sign-in/email", { email: teacherA.email, password: "not-the-password" });
    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("does not expose registration or other library endpoints", async () => {
    const signUp = await authRequest("/sign-up/email", { email: "new@example.test", password: "whatever-123", name: "x" });
    expect(signUp.status).toBe(404);
    const reset = await authRequest("/request-password-reset", { email: teacherA.email });
    expect(reset.status).toBe(404);
  });
});

describe("teacher procedures", () => {
  it("refuse a request without a session", async () => {
    const caller = createServerCaller(new Headers());
    await expect(caller.teacher.students.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.teacher.session.me()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("refuse a forged session cookie", async () => {
    const caller = createServerCaller(new Headers({ cookie: "better-auth.session_token=forged.value" }));
    await expect(caller.teacher.students.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("show each teacher only their own students", async () => {
    const listA = await createServerCaller(sessionA).teacher.students.list();
    const listB = await createServerCaller(sessionB).teacher.students.list();

    expect(listA).toEqual([]);
    expect(listB).toEqual([{ id: expect.any(String), displayName: seedStudents[0]?.displayName }]);
  });
});

describe("sign-in attempt limit", () => {
  it("answers 429 to repeated attempts instead of checking the password", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await authRequest("/sign-in/email", { email: teacherA.email, password: "not-the-password" });
      statuses.push(response.status);
    }
    expect(statuses).toContain(429);
  });
});
