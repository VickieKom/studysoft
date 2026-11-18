import { readdir } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_VIDEO_BYTES } from "../../../domain/library";
import { closeDb, db } from "../../db/client";
import { blob, libraryMaterial } from "../../db/schema";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleLibraryFileRequest, handleLibraryVideoUpload } from "../index";

// «Библиотека» (#115): games with tags, served sandboxed to their teacher;
// warm-ups, a picture or a list of questions (#116), and videos (#117), a link
// or an own file uploaded as a stream. The games, pictures and video heads are
// synthetic, written here. Each test filters by a topic of its own, so
// materials made by the other tests never get in the way.

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
    range: response.headers.get("Content-Range"),
    length: response.headers.get("Content-Length"),
    body: await response.text(),
  };
}

// An MP4 head followed by filler: the type is told by the first bytes only.
const MP4_HEAD = Buffer.from("\0\0\0\x18ftypisom\0\0\0\0isommp41", "latin1");
const video = (size: number) => {
  const bytes = Buffer.alloc(size, 0x2e);
  MP4_HEAD.copy(bytes);
  for (let i = MP4_HEAD.byteLength; i < size; i++) bytes[i] = i % 251;
  return bytes;
};

/** A body that arrives in chunks, as an upload from the browser does; counts how many were pulled. */
function chunked(chunk: Uint8Array, count: number) {
  const stats = { pulled: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (stats.pulled === count) return controller.close();
      stats.pulled += 1;
      controller.enqueue(chunk);
    },
    // Nothing is pulled ahead: a chunk is read only when the reader asks for it.
  }, { highWaterMark: 0 });
  return { stream, stats };
}

async function upload(headers: Headers, body: BodyInit | null, extra: Record<string, string> = {}) {
  const request = new Headers(headers);
  for (const [k, v] of Object.entries(extra)) request.set(k, v);
  const response = await handleLibraryVideoUpload(
    new Request(`${env().APP_URL}/api/files/library`, { method: "PUT", headers: request, body, duplex: "half" } as RequestInit),
  );
  const text = await response.text();
  return { status: response.status, body: (response.headers.get("Content-Type")?.includes("json") ? JSON.parse(text) : { text }) as { file?: string; error?: string } };
}

/** Files the store holds, finished or being written. */
async function storedFiles() {
  return (await readdir(env().FILES_DIR).catch(() => [] as string[])).sort();
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
      url: null,
      fileUrl: `/api/files/library/${id}`,
      questions: null,
      warmup: false,
      // Uploaded by the teacher: in the library at once, not a draft (#120).
      draft: false,
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

  it("saves a video link with tags; it has no file, and a link that is not http or https is refused", async () => {
    const topic = `links ${run}`;
    const url = "https://video.example.test/watch?v=1";
    const { id } = await teacher.teacher.library.addVideoLink({ title: "Explained", level: "B1", topic, ageGroup: "teens", url: ` ${url} ` });

    expect(await teacher.teacher.library.get({ id })).toEqual({
      id,
      kind: "video",
      title: "Explained",
      level: "B1",
      topic,
      ageGroup: "teens",
      url,
      fileUrl: null,
      // A video is neither a questions warm-up nor a game marked as one (#116).
      questions: null,
      warmup: false,
    });
    expect((await teacher.teacher.library.list({ kind: "video", topic })).materials.map((m) => m.id)).toEqual([id]);
    expect((await teacher.teacher.library.list({ kind: "game", topic })).materials).toEqual([]);
    // A link has no file: the same 404 as a missing one.
    expect((await fetchFile(teacherHeaders, id)).status).toBe(404);

    for (const bad of ["javascript:alert(1)", "data:text/html,hi", "video.example.test", ""]) {
      await expect(
        teacher.teacher.library.addVideoLink({ title: "Bad", level: "A1", topic, ageGroup: "younger", url: bad }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("http") });
    }
    expect((await teacher.teacher.library.list({ topic })).materials).toHaveLength(1);
  });

  it("keeps an uploaded video as it streams in, saves it with tags, and serves it whole and in byte ranges to its teacher only", async () => {
    const topic = `clips ${run}`;
    const bytes = video(300_000);
    const { stream } = chunked(bytes, 1);
    const uploaded = await upload(teacherHeaders, stream);
    expect(uploaded.status).toBe(201);
    const file = uploaded.body.file!;
    const [row] = await db().select({ contentType: blob.contentType, size: blob.size }).from(blob).where(eq(blob.id, file));
    expect(row).toEqual({ contentType: "video/mp4", size: bytes.byteLength });

    const { id } = await teacher.teacher.library.addVideoFile({ title: "Mascot", level: "A1", topic, ageGroup: "younger", file });
    expect(await teacher.teacher.library.get({ id })).toMatchObject({ kind: "video", url: null, fileUrl: `/api/files/library/${id}` });

    const whole = await fetchFile(teacherHeaders, id);
    expect(whole).toMatchObject({ status: 200, type: "video/mp4", length: String(bytes.byteLength) });
    const wholeBytes = Buffer.from(await (await handleLibraryFileRequest(new Request(`${env().APP_URL}/x`, { headers: teacherHeaders }), id)).arrayBuffer());
    expect(Buffer.compare(wholeBytes, bytes)).toBe(0);

    const ranged = async (range: string) => {
      const headers = new Headers(teacherHeaders);
      headers.set("Range", range);
      const response = await handleLibraryFileRequest(new Request(`${env().APP_URL}/x`, { headers }), id);
      return { status: response.status, range: response.headers.get("Content-Range"), bytes: Buffer.from(await response.arrayBuffer()) };
    };
    const middle = await ranged("bytes=1000-1999");
    expect(middle.status).toBe(206);
    expect(middle.range).toBe(`bytes 1000-1999/${bytes.byteLength}`);
    expect(Buffer.compare(middle.bytes, bytes.subarray(1000, 2000))).toBe(0);
    const tail = await ranged("bytes=-10");
    expect(tail.range).toBe(`bytes ${bytes.byteLength - 10}-${bytes.byteLength - 1}/${bytes.byteLength}`);
    expect(Buffer.compare(tail.bytes, bytes.subarray(-10))).toBe(0);
    expect((await ranged(`bytes=${bytes.byteLength}-`)).status).toBe(416);

    // Another teacher and no session: the same 404 as a missing file, with or without a range.
    const missing = await fetchFile(teacherHeaders, "00000000-0000-4000-8000-000000000000");
    for (const headers of [otherHeaders, new Headers()]) {
      for (const extra of [{}, { Range: "bytes=0-99" }] as Record<string, string>[]) {
        const foreign = await fetchFile(headers, id, extra);
        expect({ status: foreign.status, body: foreign.body }).toEqual({ status: 404, body: missing.body });
      }
    }
    // Nor can another teacher upload as this one or save a material on this teacher's file.
    expect((await upload(new Headers(), chunked(bytes, 1).stream)).status).toBe(404);
    await expect(
      otherTeacher.teacher.library.addVideoFile({ title: "Theirs", level: "A1", topic, ageGroup: "younger", file }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("refuses a video over 200 MB as it streams, without reading the rest, and keeps nothing", async () => {
    const before = await storedFiles();
    const blobsBefore = (await db().select({ id: blob.id }).from(blob)).length;
    const chunk = video(1024 * 1024);
    const count = MAX_VIDEO_BYTES / chunk.byteLength + 5;
    // No Content-Length, as with a chunked upload: the limit is counted as the bytes arrive.
    const body = chunked(chunk, count);
    const refused = await upload(teacherHeaders, body.stream);
    expect(refused).toEqual({ status: 413, body: { error: "Файл больше 200 МБ" } });
    expect(body.stats.pulled).toBeLessThan(count);
    // A declared length over the limit is refused before a byte is read.
    const declared = chunked(chunk, 1);
    expect((await upload(teacherHeaders, declared.stream, { "Content-Length": String(MAX_VIDEO_BYTES + 1) })).status).toBe(413);
    expect(declared.stats.pulled).toBe(0);

    expect(await storedFiles()).toEqual(before);
    expect((await db().select({ id: blob.id }).from(blob)).length).toBe(blobsBefore);
  });

  it("refuses FLV and other formats with a message, and a material on a file that is not a video", async () => {
    const topic = `formats ${run}`;
    const before = await storedFiles();
    for (const head of [
      Buffer.from([0x46, 0x4c, 0x56, 0x01, 0x05, 0, 0, 0, 0x09, ...new Array(64).fill(0)]),
      Buffer.from("RIFF\0\0\0\0AVI LIST".padEnd(80, "\0"), "latin1"),
      Buffer.from(""),
    ]) {
      const refused = await upload(teacherHeaders, head);
      expect(refused.status).toBe(415);
      expect(refused.body.error).toContain("MP4");
    }
    expect(await storedFiles()).toEqual(before);

    // A game's file is this teacher's, but not a video.
    const { id: game } = await teacher.teacher.library.addGame({ title: "Game", level: "A1", topic, ageGroup: "younger", html: html("Game") });
    const [row] = await db().select({ file: libraryMaterial.blobId }).from(libraryMaterial).where(eq(libraryMaterial.id, game));
    await expect(
      teacher.teacher.library.addVideoFile({ title: "Not a video", level: "A1", topic, ageGroup: "younger", file: row!.file! }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      teacher.teacher.library.addVideoFile({ title: "Nothing", level: "A1", topic, ageGroup: "younger", file: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await teacher.teacher.library.list({ topic })).materials.map((m) => m.id)).toEqual([game]);
  });
});
