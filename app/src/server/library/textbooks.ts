// Textbook sets (#156): the teacher uploads the books (PDF) and the folder
// of tracks; each book's pages are rendered to images in the background with
// poppler's pdftoppm (architecture, section 5: deterministic, no AI). A set
// and everything in it are the teacher's only.
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { and, asc, desc, eq, inArray, ne, or } from "drizzle-orm";
import { type BookKind, MAX_TRACKS, MAX_TRACKS_BYTES, type RenderStatus } from "../../domain/textbook";
import { openBlob, saveBlob } from "../blob/store";
import type { Database } from "../db/client";
import { blob, textbook, textbookFile, textbookPage } from "../db/schema";

const run = promisify(execFile);

/** A PDF starts with its version line. */
export function sniffPdf(head: Uint8Array): string | null {
  return String.fromCharCode(...head.slice(0, 5)) === "%PDF-" ? "application/pdf" : null;
}

/** A track: MP3 (frames or an ID3 tag), M4A (an ISO box), WAV or Ogg, as a task's recording is (#127). */
export function sniffTrack(head: Uint8Array): string | null {
  const ascii = (offset: number, length: number) => String.fromCharCode(...head.slice(offset, offset + length));
  if (ascii(0, 3) === "ID3" || (head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0)) return "audio/mpeg";
  if (ascii(4, 4) === "ftyp") return "audio/mp4";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return "audio/wav";
  if (ascii(0, 4) === "OggS") return "audio/ogg";
  return null;
}

/**
 * This server process. A book left "rendering" by another process — one
 * that stopped or restarted mid-way — reads as failed and can be tried again
 * (architecture, failure modes).
 */
export const BOOT_ID = crypto.randomUUID();

/**
 * A book's status as the teacher sees it. "queued" — saved, its rendering
 * about to start — reads as rendering; a rendering or a queue left by a
 * process that has stopped reads as failed.
 */
function statusOf(row: { renderStatus: string | null; renderBoot: string | null }): RenderStatus {
  if ((row.renderStatus === "rendering" || row.renderStatus === "queued") && row.renderBoot !== BOOT_ID) return "failed";
  if (row.renderStatus === "queued") return "rendering";
  return (row.renderStatus ?? "failed") as RenderStatus;
}

export type NewTextbook = {
  title: string;
  level: string;
  books: { kind: BookKind; name: string; file: string }[];
  tracks: { name: string; file: string }[];
};

/**
 * Saves a set whose files were uploaded first (`/api/files/textbooks`) and
 * returns its id, or a message the teacher reads. Each file must be this
 * teacher's, of its kind, and not in another set; the tracks together stay
 * within 500 MB. The books' rendering starts after it is saved.
 */
export async function createTextbook(db: Database, teacherId: string, input: NewTextbook): Promise<{ id: string } | { error: string }> {
  if (input.books.length === 0) return { error: "Добавьте хотя бы одну книгу в PDF" };
  if (new Set(input.books.map((b) => b.kind)).size !== input.books.length) return { error: "Каждая книга — один файл" };
  if (input.tracks.length > MAX_TRACKS) return { error: `Не больше ${MAX_TRACKS} треков` };
  const ids = [...input.books.map((b) => b.file), ...input.tracks.map((t) => t.file)];
  if (new Set(ids).size !== ids.length) return { error: "Один и тот же файл добавлен дважды" };

  const created = await db.transaction(async (tx) => {
    const files = await tx
      .select({ id: blob.id, contentType: blob.contentType, size: blob.size, used: textbookFile.id })
      .from(blob)
      .leftJoin(textbookFile, eq(textbookFile.blobId, blob.id))
      .where(and(inArray(blob.id, ids), eq(blob.teacherId, teacherId)))
      .for("update", { of: blob });
    const byId = new Map(files.map((f) => [f.id, f]));
    const fits = (id: string, pdf: boolean) => {
      const file = byId.get(id);
      return file && !file.used && (pdf ? file.contentType === "application/pdf" : file.contentType.startsWith("audio/"));
    };
    if (!input.books.every((b) => fits(b.file, true)) || !input.tracks.every((t) => fits(t.file, false))) {
      return { error: "Файл не найден: загрузите его ещё раз" };
    }
    const tracksSize = input.tracks.reduce((sum, t) => sum + Number(byId.get(t.file)!.size), 0);
    if (tracksSize > MAX_TRACKS_BYTES) return { error: "Треки вместе больше 500 МБ" };

    const [row] = await tx
      .insert(textbook)
      .values({ teacherId, title: input.title, level: input.level })
      .returning({ id: textbook.id });
    const books = await tx
      .insert(textbookFile)
      .values(
        input.books.map((b, position) => ({
          textbookId: row!.id,
          kind: b.kind,
          name: b.name,
          blobId: b.file,
          position,
          renderStatus: "queued",
          renderBoot: BOOT_ID,
        })),
      )
      .returning({ id: textbookFile.id });
    if (input.tracks.length > 0) {
      await tx
        .insert(textbookFile)
        .values(input.tracks.map((t, position) => ({ textbookId: row!.id, kind: "track", name: t.name, blobId: t.file, position })));
    }
    return { id: row!.id, books: books.map((b) => b.id) };
  });
  if ("error" in created) return created;
  for (const fileId of created.books) void renderBook(db, teacherId, fileId);
  return { id: created.id };
}

/** This teacher's sets, newest first. */
export async function listTextbooks(db: Database, teacherId: string) {
  return db
    .select({ id: textbook.id, title: textbook.title, level: textbook.level })
    .from(textbook)
    .where(eq(textbook.teacherId, teacherId))
    .orderBy(desc(textbook.createdAt));
}

/** One set of this teacher with its books (status and pages) and tracks, or null. */
export async function findTextbook(db: Database, teacherId: string, id: string) {
  const [row] = await db
    .select({ id: textbook.id, title: textbook.title, level: textbook.level })
    .from(textbook)
    .where(and(eq(textbook.id, id), eq(textbook.teacherId, teacherId)));
  if (!row) return null;
  const files = await db
    .select({
      id: textbookFile.id,
      kind: textbookFile.kind,
      name: textbookFile.name,
      pageCount: textbookFile.pageCount,
      renderStatus: textbookFile.renderStatus,
      renderBoot: textbookFile.renderBoot,
    })
    .from(textbookFile)
    .where(eq(textbookFile.textbookId, id))
    .orderBy(asc(textbookFile.kind), asc(textbookFile.position));
  return {
    ...row,
    books: files
      .filter((f) => f.kind !== "track")
      .map((f) => {
        const status = statusOf(f);
        return { id: f.id, kind: f.kind as BookKind, name: f.name, status, pageCount: status === "done" ? (f.pageCount ?? 0) : 0 };
      }),
    tracks: files.filter((f) => f.kind === "track").map((f) => ({ id: f.id, name: f.name })),
  };
}

/** What a page of a rendered book is rendered at: enough for a page on a screen, about 0.3 GB a level (architecture, section 9). */
const RENDER_DPI = "110";

/**
 * Renders a book's pages and keeps them. It takes the book only when no
 * running process has it — a new one, a failed one, or one left "rendering"
 * by a process that stopped — so two renderings of one book never overlap.
 * Returns whether this call rendered it; a failure leaves "failed".
 */
export async function renderBook(db: Database, teacherId: string, fileId: string): Promise<boolean> {
  const blobId = await takeBook(db, teacherId, fileId);
  return blobId !== null && renderTaken(db, teacherId, fileId, blobId);
}

/** Takes a book for this process to render, as renderBook says; returns its PDF's file, or null when it is not to be taken. */
async function takeBook(db: Database, teacherId: string, fileId: string): Promise<string | null> {
  const [taken] = await db
    .update(textbookFile)
    .set({ renderStatus: "rendering", renderBoot: BOOT_ID })
    .where(
      and(
        eq(textbookFile.id, fileId),
        ne(textbookFile.kind, "track"),
        inArray(
          textbookFile.textbookId,
          db.select({ id: textbook.id }).from(textbook).where(eq(textbook.teacherId, teacherId)),
        ),
        or(
          inArray(textbookFile.renderStatus, ["queued", "failed"]),
          and(eq(textbookFile.renderStatus, "rendering"), ne(textbookFile.renderBoot, BOOT_ID)),
        ),
      ),
    )
    .returning({ blobId: textbookFile.blobId });
  return taken?.blobId ?? null;
}

/** Renders a book this process has taken. */
async function renderTaken(db: Database, teacherId: string, fileId: string, blobId: string): Promise<boolean> {
  const dir = await mkdtemp(join(tmpdir(), "studysoft-book-"));
  try {
    const source = await openBlob(db, teacherId, blobId);
    if (!source) throw new Error("renderBook: the book's file is missing");
    const pdf = join(dir, "book.pdf");
    await pipeline(Readable.fromWeb(source.reader.stream() as never), createWriteStream(pdf));
    await run(process.env.PDFTOPPM ?? "pdftoppm", ["-r", RENDER_DPI, "-jpeg", "-jpegopt", "quality=80", pdf, join(dir, "page")], {
      timeout: 30 * 60_000,
    });
    // pdftoppm pads the numbers to the width of the last one: page-01.jpg … page-12.jpg.
    const pages = (await readdir(dir))
      .filter((name) => /^page-\d+\.jpg$/.test(name))
      .sort((a, b) => Number(a.slice(5, -4)) - Number(b.slice(5, -4)));
    if (pages.length === 0) throw new Error("renderBook: no pages");

    // A book tried again starts from no pages.
    await db.delete(textbookPage).where(eq(textbookPage.fileId, fileId));
    for (const [i, name] of pages.entries()) {
      const id = await saveBlob(db, teacherId, new Uint8Array(await readFile(join(dir, name))), "image/jpeg");
      await db.insert(textbookPage).values({ fileId, number: i + 1, blobId: id });
    }
    await db
      .update(textbookFile)
      .set({ renderStatus: "done", pageCount: pages.length })
      .where(and(eq(textbookFile.id, fileId), eq(textbookFile.renderBoot, BOOT_ID)));
    return true;
  } catch (error) {
    // Logs carry identifiers only.
    console.error(`textbook ${fileId}: rendering failed`, error instanceof Error ? error.message : "");
    await db
      .update(textbookFile)
      .set({ renderStatus: "failed" })
      .where(and(eq(textbookFile.id, fileId), eq(textbookFile.renderBoot, BOOT_ID)));
    return false;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * «Повторить»: takes a failed book — so it reads as rendering from now on —
 * and renders it in the background. Returns false when there is no such book
 * of this teacher, or it is not failed.
 */
export async function retryRender(db: Database, teacherId: string, fileId: string): Promise<boolean> {
  const [row] = await db
    .select({ renderStatus: textbookFile.renderStatus, renderBoot: textbookFile.renderBoot })
    .from(textbookFile)
    .innerJoin(textbook, eq(textbook.id, textbookFile.textbookId))
    .where(and(eq(textbookFile.id, fileId), eq(textbook.teacherId, teacherId), ne(textbookFile.kind, "track")));
  if (!row || statusOf(row) !== "failed") return false;
  const blobId = await takeBook(db, teacherId, fileId);
  if (blobId === null) return false;
  void renderTaken(db, teacherId, fileId, blobId);
  return true;
}

/**
 * The stored file behind a textbook address of this teacher: a book or a
 * track itself, or with `page` one rendered page of a book. Null for anything
 * else, which the caller answers with the same 404.
 */
export async function textbookBlob(db: Database, teacherId: string, fileId: string, page: number | null): Promise<string | null> {
  if (page === null) {
    const [row] = await db
      .select({ blobId: textbookFile.blobId })
      .from(textbookFile)
      .innerJoin(textbook, eq(textbook.id, textbookFile.textbookId))
      .where(and(eq(textbookFile.id, fileId), eq(textbook.teacherId, teacherId)));
    return row?.blobId ?? null;
  }
  const [row] = await db
    .select({ blobId: textbookPage.blobId })
    .from(textbookPage)
    .innerJoin(textbookFile, eq(textbookFile.id, textbookPage.fileId))
    .innerJoin(textbook, eq(textbook.id, textbookFile.textbookId))
    .where(and(eq(textbookPage.fileId, fileId), eq(textbookPage.number, page), eq(textbook.teacherId, teacherId)));
  return row?.blobId ?? null;
}

/** The most pages one read of a book's text layer returns (#150): a lesson or two at a time. */
export const MAX_TEXT_PAGES = 20;

/**
 * The text layer of a book's pages `from`–`to` (#150), page by page, as
 * poppler's pdftotext reads it with the layout kept; for the assistant to
 * mark the book out. Null when it is not this teacher's book.
 */
export async function bookText(
  db: Database,
  teacherId: string,
  fileId: string,
  from: number,
  to: number,
): Promise<{ page: number; text: string }[] | null> {
  const blobId = await textbookBlob(db, teacherId, fileId, null);
  const source = blobId ? await openBlob(db, teacherId, blobId) : null;
  if (!source || source.contentType !== "application/pdf") {
    await source?.reader.close();
    return null;
  }
  const dir = await mkdtemp(join(tmpdir(), "studysoft-text-"));
  try {
    const pdf = join(dir, "book.pdf");
    await pipeline(Readable.fromWeb(source.reader.stream() as never), createWriteStream(pdf));
    const pages: { page: number; text: string }[] = [];
    for (let page = from; page <= to; page++) {
      const { stdout } = await run(process.env.PDFTOTEXT ?? "pdftotext", ["-layout", "-f", String(page), "-l", String(page), pdf, "-"], {
        maxBuffer: 4 * 1024 * 1024,
      }).catch(() => ({ stdout: "" }));
      pages.push({ page, text: stdout.replace(/\f/g, "").trimEnd() });
    }
    return pages;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
