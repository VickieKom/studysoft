import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "../../db/client";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleLibraryFileRequest } from "../index";

// «Библиотека» (#115): games with tags, served sandboxed to their teacher.
// The games are synthetic HTML written here. Each test filters by a topic of
// its own, so materials made by the other tests never get in the way.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];

let teacherHeaders: Headers;
let teacher: ReturnType<typeof createServerCaller>;
let otherHeaders: Headers;
let otherTeacher: ReturnType<typeof createServerCaller>;

const run = crypto.randomUUID().slice(0, 8);
const html = (title: string) => `<!doctype html><html><body><h1>${title}</h1><script>document.title = "ok";</script></body></html>`;

async function fetchFile(headers: Headers, id: string, extra: Record<string, string> = {}) {
  const request = new Headers(headers);
  for (const [k, v] of Object.entries(extra)) request.set(k, v);
  const response = await handleLibraryFileRequest(new Request(`${env().APP_URL}/api/files/library/${id}`, { headers: request }), id);
  return {
    status: response.status,
    type: response.headers.get("Content-Type"),
    csp: response.headers.get("Content-Security-Policy"),
    etag: response.headers.get("ETag"),
    body: await response.text(),
  };
}

beforeAll(async () => {
  teacherHeaders = await signedInHeaders(teacherA);
  teacher = createServerCaller(teacherHeaders);
  otherHeaders = await signedInHeaders(teacherB);
  otherTeacher = createServerCaller(otherHeaders);
});

afterAll(closeDb);

describe("teacher.library", () => {
  it("saves a game with its tags, lists it under its filters, and serves its file sandboxed to its teacher only", async () => {
    const topic = `colours ${run}`;
    const { id } = await teacher.teacher.library.addGame({ title: "Colour hunt", level: "A2", topic, ageGroup: "younger", html: html("Colour hunt") });

    expect(await teacher.teacher.library.get({ id })).toEqual({
      id,
      kind: "game",
      title: "Colour hunt",
      level: "A2",
      topic,
      ageGroup: "younger",
      fileUrl: `/api/files/library/${id}`,
    });
    const listed = await teacher.teacher.library.list({ kind: "game", topic });
    expect(listed.materials.map((m) => m.id)).toEqual([id]);
    expect(listed.topics).toContain(topic);
    expect((await teacher.teacher.library.list({ kind: "warmup", topic })).materials).toEqual([]);
    expect((await teacher.teacher.library.list({ topic, level: "B1" })).materials).toEqual([]);
    expect((await teacher.teacher.library.list({ topic, ageGroup: "teens" })).materials).toEqual([]);

    const file = await fetchFile(teacherHeaders, id);
    expect(file).toMatchObject({ status: 200, type: "text/html; charset=utf-8", body: html("Colour hunt") });
    // Opened by its address too, the page runs in an origin of its own: no cookies, no access to the platform.
    expect(file.csp).toMatch(/^sandbox allow-scripts\b/);
    expect(file.csp).not.toContain("allow-same-origin");
    expect((await fetchFile(teacherHeaders, id, { "If-None-Match": file.etag! })).status).toBe(304);

    // Another teacher, no session and a missing id: the same 404.
    const missing = await fetchFile(teacherHeaders, "00000000-0000-4000-8000-000000000000");
    expect(missing.status).toBe(404);
    for (const headers of [otherHeaders, new Headers()]) {
      const foreign = await fetchFile(headers, id);
      expect({ status: foreign.status, body: foreign.body }).toEqual({ status: 404, body: missing.body });
    }
    await expect(otherTeacher.teacher.library.get({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await otherTeacher.teacher.library.list({ topic })).materials).toEqual([]);
    expect((await otherTeacher.teacher.library.list({})).topics).not.toContain(topic);
  });

  it("refuses a file over 5 MB and one that is not an HTML page, and saves nothing", async () => {
    const topic = `refused ${run}`;
    const huge = html("Huge") + " ".repeat(5 * 1024 * 1024);
    await expect(
      teacher.teacher.library.addGame({ title: "Huge", level: "A1", topic, ageGroup: "younger", html: huge }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    for (const notHtml of ["%PDF-1.4 not a game", "console.log('a script alone')", ""]) {
      await expect(
        teacher.teacher.library.addGame({ title: "Not a game", level: "A1", topic, ageGroup: "younger", html: notHtml }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("HTML") });
    }
    expect((await teacher.teacher.library.list({ topic })).materials).toEqual([]);
  });

  it("renames and retags, and once deleted the game and its file are gone; another teacher can do neither", async () => {
    const topic = `food ${run}`;
    const { id } = await teacher.teacher.library.addGame({ title: "Draft", level: "A2", topic, ageGroup: "younger", html: html("Draft") });

    await expect(
      otherTeacher.teacher.library.update({ id, title: "Theirs", level: "C1", topic: "", ageGroup: "teens" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(otherTeacher.teacher.library.remove({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });

    await teacher.teacher.library.update({ id, title: "Food bingo", level: "A1", topic: "  ", ageGroup: "teens" });
    expect(await teacher.teacher.library.get({ id })).toMatchObject({ title: "Food bingo", level: "A1", topic: null, ageGroup: "teens" });

    await teacher.teacher.library.remove({ id });
    await expect(teacher.teacher.library.get({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await fetchFile(teacherHeaders, id)).status).toBe(404);
    await expect(teacher.teacher.library.remove({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
