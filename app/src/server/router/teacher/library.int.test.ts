import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "../../db/client";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleLibraryFileRequest } from "../index";

// «Библиотека» (#115): games with tags, served sandboxed to their teacher;
// warm-ups, a picture or a list of questions (#116). The games and pictures
// are synthetic, written here. Each test filters by a topic of
// its own, so materials made by the other tests never get in the way.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];

let teacherHeaders: Headers;
let teacher: ReturnType<typeof createServerCaller>;
let otherHeaders: Headers;
let otherTeacher: ReturnType<typeof createServerCaller>;

const run = crypto.randomUUID().slice(0, 8);
// A 1×1 PNG and a 1×1 GIF, written for this test.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const GIF = "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
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
      questions: null,
      warmup: false,
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

  it("saves a picture warm-up and serves the picture to its teacher only, and a questions warm-up with its questions trimmed", async () => {
    const topic = `warm-ups ${run}`;
    const picture = await teacher.teacher.library.addWarmup({ format: "picture", title: "Mood", level: "A2", topic, ageGroup: "younger", picture: PNG });
    const questions = await teacher.teacher.library.addWarmup({
      format: "questions",
      title: "Talk",
      level: "B1",
      topic,
      ageGroup: "teens",
      questions: ["  What did you do at the weekend? ", "", "What makes you laugh?", "   "],
    });

    expect(await teacher.teacher.library.get({ id: picture.id })).toMatchObject({
      kind: "warmup",
      fileUrl: `/api/files/library/${picture.id}`,
      questions: null,
      warmup: false,
    });
    expect(await teacher.teacher.library.get({ id: questions.id })).toMatchObject({
      kind: "warmup",
      fileUrl: null,
      questions: ["What did you do at the weekend?", "What makes you laugh?"],
    });
    const listed = await teacher.teacher.library.list({ kind: "warmup", topic });
    expect(listed.materials.map((m) => m.id).sort()).toEqual([picture.id, questions.id].sort());
    expect((await teacher.teacher.library.list({ kind: "game", topic })).materials).toEqual([]);

    const file = await handleLibraryFileRequest(
      new Request(`${env().APP_URL}/api/files/library/${picture.id}`, { headers: teacherHeaders }),
      picture.id,
    );
    expect(file.status).toBe(200);
    expect(file.headers.get("Content-Type")).toBe("image/png");
    expect(Buffer.from(await file.arrayBuffer())).toEqual(Buffer.from(PNG, "base64"));
    // A questions warm-up has no file: the same 404 as a missing one.
    const missing = await fetchFile(teacherHeaders, "00000000-0000-4000-8000-000000000000");
    expect(await fetchFile(teacherHeaders, questions.id)).toMatchObject({ status: 404, body: missing.body });
    for (const headers of [otherHeaders, new Headers()]) {
      expect(await fetchFile(headers, picture.id)).toMatchObject({ status: 404, body: missing.body });
    }
    for (const id of [picture.id, questions.id]) {
      await expect(otherTeacher.teacher.library.get({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect((await otherTeacher.teacher.library.list({ kind: "warmup", topic })).materials).toEqual([]);
  });

  it("refuses a picture over 2 MB, one of another type and a list without questions, and saves nothing", async () => {
    const topic = `refused warm-ups ${run}`;
    const tags = { title: "Refused", level: "A1" as const, topic, ageGroup: "younger" as const };
    const huge = Buffer.concat([Buffer.from(PNG, "base64"), Buffer.alloc(2 * 1024 * 1024)]).toString("base64");
    await expect(teacher.teacher.library.addWarmup({ ...tags, format: "picture", picture: huge })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("2 МБ"),
    });
    await expect(teacher.teacher.library.addWarmup({ ...tags, format: "picture", picture: GIF })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("PNG"),
    });
    for (const list of [[], ["", "  "], Array.from({ length: 31 }, (_, i) => `Question ${i}?`), ["x".repeat(301)]]) {
      await expect(teacher.teacher.library.addWarmup({ ...tags, format: "questions", questions: list })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringMatching(/вопрос/i),
      });
    }
    expect((await teacher.teacher.library.list({ topic })).materials).toEqual([]);
  });

  it("lists a game marked as a warm-up under both, and keeps the mark and the questions only where they belong", async () => {
    const topic = `marked ${run}`;
    const tags = { level: "A2" as const, topic, ageGroup: "younger" as const };
    const game = await teacher.teacher.library.addGame({ ...tags, title: "Chain", html: html("Chain") });
    const picture = await teacher.teacher.library.addWarmup({ ...tags, format: "picture", title: "Faces", picture: PNG });
    const talk = await teacher.teacher.library.addWarmup({ ...tags, format: "questions", title: "Talk", questions: ["One?"] });

    await teacher.teacher.library.update({ id: game.id, ...tags, title: "Chain", warmup: true });
    expect((await teacher.teacher.library.list({ kind: "game", topic })).materials.map((m) => m.id)).toEqual([game.id]);
    expect((await teacher.teacher.library.list({ kind: "warmup", topic })).materials.map((m) => m.id).sort()).toEqual(
      [game.id, picture.id, talk.id].sort(),
    );

    // The mark on a warm-up and questions on a game or a picture change nothing.
    await teacher.teacher.library.update({ id: picture.id, ...tags, title: "Faces", warmup: true, questions: ["Sneaked in?"] });
    await teacher.teacher.library.update({ id: game.id, ...tags, title: "Chain", questions: ["Sneaked in?"] });
    expect(await teacher.teacher.library.get({ id: picture.id })).toMatchObject({ warmup: false, questions: null });
    expect(await teacher.teacher.library.get({ id: game.id })).toMatchObject({ warmup: true, questions: null });

    await teacher.teacher.library.update({ id: talk.id, ...tags, title: "Talk 2", questions: ["One?", " Two? "] });
    expect(await teacher.teacher.library.get({ id: talk.id })).toMatchObject({ title: "Talk 2", questions: ["One?", "Two?"] });
    await expect(
      teacher.teacher.library.update({ id: talk.id, ...tags, title: "Talk 2", questions: [" "] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await teacher.teacher.library.get({ id: talk.id })).toMatchObject({ questions: ["One?", "Two?"] });

    await teacher.teacher.library.update({ id: game.id, ...tags, title: "Chain", warmup: false });
    expect((await teacher.teacher.library.list({ kind: "warmup", topic })).materials.map((m) => m.id)).not.toContain(game.id);

    await expect(
      otherTeacher.teacher.library.update({ id: talk.id, ...tags, title: "Theirs", questions: ["Theirs?"] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await teacher.teacher.library.get({ id: talk.id })).toMatchObject({ title: "Talk 2", questions: ["One?", "Two?"] });
  });
});
