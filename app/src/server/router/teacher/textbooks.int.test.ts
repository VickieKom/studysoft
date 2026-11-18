import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { removeUnreferencedBlobs } from "../../blob/store";
import { closeDb, db } from "../../db/client";
import { blob, textbook, textbookFile, textbookPage } from "../../db/schema";
import { env } from "../../env";
import { renderBook } from "../../library/textbooks";
import { mp3, pdf } from "../../testing/files";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest, handleTextbookFileRequest, handleTextbookUpload } from "../index";

// Textbook sets (#156): files uploaded first, then the set; the books'
// pages rendered in the background with pdftoppm; everything served to its
// teacher only. The PDF and the tracks are synthetic (testing/files.ts).

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacherHeaders: Headers;
let otherHeaders: Headers;
let teacher: ReturnType<typeof createServerCaller>;
let teacherId: string;
const json = (value: unknown) => JSON.stringify(value);
const MISSING = "00000000-0000-4000-8000-000000000000";

async function upload(headers: Headers, kind: string, bytes: Buffer, extra: Record<string, string> = {}) {
  const response = await handleTextbookUpload(
    new Request(`${env().APP_URL}/api/files/textbooks?kind=${kind}`, { method: "PUT", headers: new Headers([...headers, ...Object.entries(extra)]), body: new Uint8Array(bytes) }),
  );
  return { status: response.status, body: (await response.json().catch(() => null)) as { file?: string; error?: string } | null };
}

async function fetchFile(headers: Headers, fileId: string, page: string | null, range?: string) {
  const path = page === null ? fileId : `${fileId}/pages/${page}`;
  const request = new Request(`${env().APP_URL}/api/files/textbooks/${path}`, {
    headers: range ? new Headers([...headers, ["Range", range]]) : headers,
  });
  const response = await handleTextbookFileRequest(request, fileId, page);
  return { status: response.status, type: response.headers.get("Content-Type"), body: Buffer.from(await response.arrayBuffer()) };
}

/** Uploads a three-page book and two tracks and saves the set; returns its id. */
async function newTextbook(title: string) {
  const book = (await upload(teacherHeaders, "book", pdf(3))).body!.file!;
  const tracks = [(await upload(teacherHeaders, "track", mp3())).body!.file!, (await upload(teacherHeaders, "track", mp3())).body!.file!];
  const { id } = await teacher.teacher.textbooks.create({
    title,
    level: "A2",
    books: [{ kind: "students_book", name: "book.pdf", file: book }],
    tracks: tracks.map((file, i) => ({ name: `1-0${i + 1}`, file })),
  });
  return id;
}

/** Waits until the set's books are rendered or failed. */
async function rendered(id: string) {
  for (let i = 0; i < 100; i++) {
    const found = await teacher.teacher.textbooks.get({ id });
    if (found.books.every((b) => b.status !== "rendering")) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("still rendering");
}

async function studentHeaders() {
  const { id: studentId } = await teacher.teacher.students.create({ firstName: "Без учебника", lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  const token = (await teacher.teacher.links.student({ studentId })).url.split("#")[1]!;
  const response = await handleRouterRequest(
    new Request(`${env().APP_URL}/api/trpc/links.exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: json({ token }) }),
  );
  return new Headers({ cookie: response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES.student}=`))!.split(";")[0]! });
}

beforeAll(async () => {
  teacherHeaders = await signedInHeaders(teacherA);
  otherHeaders = await signedInHeaders(teacherB);
  teacher = createServerCaller(teacherHeaders);
  teacherId = (await teacher.teacher.session.me()).id;
});

afterAll(closeDb);

describe("textbook sets", () => {
  it("render a book's pages and serve the pages and tracks to their teacher, in ranges", async () => {
    const id = await newTextbook("Rendered set");
    const found = await rendered(id);
    expect(found).toMatchObject({ title: "Rendered set", level: "A2", books: [{ kind: "students_book", status: "done", pageCount: 3 }] });
    expect(found.tracks.map((t) => t.name)).toEqual(["1-01", "1-02"]);
    expect(await teacher.teacher.textbooks.list()).toEqual(expect.arrayContaining([{ id, title: "Rendered set", level: "A2" }]));

    const [book] = found.books;
    const page = await fetchFile(teacherHeaders, book!.id, "2");
    expect(page.status).toBe(200);
    expect(page.type).toBe("image/jpeg");
    expect([...page.body.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect((await fetchFile(teacherHeaders, book!.id, "4")).status).toBe(404);
    expect(await fetchFile(teacherHeaders, found.tracks[0]!.id, null)).toMatchObject({ status: 200, type: "audio/mpeg", body: mp3() });
    expect(await fetchFile(teacherHeaders, found.tracks[0]!.id, null, "bytes=0-3")).toMatchObject({ status: 206, body: mp3().subarray(0, 4) });
  });

  it("are the teacher's only: a student, another teacher and no session get the same 404 as for a missing one", async () => {
    const id = await newTextbook("Private set");
    const { books, tracks } = await rendered(id);
    const student = await studentHeaders();
    for (const headers of [student, otherHeaders, new Headers()]) {
      for (const [fileId, page] of [
        [books[0]!.id, "1"],
        [tracks[0]!.id, null],
      ] as const) {
        const missing = await fetchFile(headers, MISSING, page);
        expect(missing.status).toBe(404);
        expect(await fetchFile(headers, fileId, page)).toEqual(missing);
      }
    }
    await expect(createServerCaller(otherHeaders).teacher.textbooks.get({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createServerCaller(otherHeaders).teacher.textbooks.render({ fileId: books[0]!.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuse a file that is not a PDF, a book over 300 MB, tracks over 500 MB and another teacher's file, and save nothing", async () => {
    const before = (await teacher.teacher.textbooks.list()).length;
    expect(await upload(teacherHeaders, "book", Buffer.from("not a PDF at all"))).toMatchObject({ status: 415, body: { error: expect.stringContaining("PDF") } });
    expect((await upload(teacherHeaders, "book", mp3())).status).toBe(415);
    expect((await upload(teacherHeaders, "track", pdf(1))).status).toBe(415);
    expect((await upload(teacherHeaders, "book", pdf(1), { "Content-Length": String(300 * 1024 * 1024 + 1) })).status).toBe(413);
    expect((await upload(new Headers(), "book", pdf(1))).status).toBe(404);

    const book = (await upload(teacherHeaders, "book", pdf(1))).body!.file!;
    const track = (await upload(teacherHeaders, "track", mp3())).body!.file!;
    const books = [{ kind: "students_book" as const, name: "book.pdf", file: book }];
    // A track as a book, another teacher's book, and tracks over 500 MB together.
    await expect(
      teacher.teacher.textbooks.create({ title: "x", level: "A2", books: [{ kind: "students_book", name: "t", file: track }], tracks: [] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(createServerCaller(otherHeaders).teacher.textbooks.create({ title: "x", level: "A2", books, tracks: [] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await db().update(blob).set({ size: 500 * 1024 * 1024 + 1 }).where(eq(blob.id, track));
    await expect(teacher.teacher.textbooks.create({ title: "x", level: "A2", books, tracks: [{ name: "t", file: track }] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Треки вместе больше 500 МБ",
    });
    expect((await teacher.teacher.textbooks.list()).length).toBe(before);
  });

  it("read as failed when the process rendering them stopped, and render again once with «Повторить»", async () => {
    const id = await newTextbook("Interrupted set");
    const { books } = await rendered(id);
    const fileId = books[0]!.id;
    // A process that has since stopped left it rendering.
    await db().update(textbookFile).set({ renderStatus: "rendering", renderBoot: "a stopped process" }).where(eq(textbookFile.id, fileId));
    expect((await teacher.teacher.textbooks.get({ id })).books[0]).toMatchObject({ status: "failed", pageCount: 0 });

    // Two tries at once: only one renders.
    const tries = await Promise.all([renderBook(db(), teacherId, fileId), renderBook(db(), teacherId, fileId)]);
    expect(tries.filter(Boolean)).toHaveLength(1);
    expect((await teacher.teacher.textbooks.get({ id })).books[0]).toMatchObject({ status: "done", pageCount: 3 });
    expect(await db().select().from(textbookPage).where(eq(textbookPage.fileId, fileId))).toHaveLength(3);

    // A done book is not rendered again.
    await expect(teacher.teacher.textbooks.render({ fileId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // A failed one is, through the procedure.
    await db().update(textbookFile).set({ renderStatus: "failed" }).where(eq(textbookFile.id, fileId));
    await teacher.teacher.textbooks.render({ fileId });
    expect((await rendered(id)).books[0]).toMatchObject({ status: "done", pageCount: 3 });
  });

  it("keep their files through the cleanup, however old", async () => {
    const id = await newTextbook("Kept set");
    await rendered(id);
    const files = await db().select({ blobId: textbookFile.blobId, id: textbookFile.id }).from(textbookFile).innerJoin(textbook, eq(textbook.id, textbookFile.textbookId)).where(eq(textbook.id, id));
    const [page] = await db().select({ blobId: textbookPage.blobId }).from(textbookPage).where(eq(textbookPage.fileId, files[0]!.id));
    const kept = [...files.map((f) => f.blobId), page!.blobId];
    for (const blobId of kept) await db().update(blob).set({ createdAt: new Date(Date.now() - 48 * 3_600_000) }).where(eq(blob.id, blobId));
    await removeUnreferencedBlobs(db());
    for (const blobId of kept) expect(await db().select().from(blob).where(eq(blob.id, blobId))).toHaveLength(1);
  });
});

