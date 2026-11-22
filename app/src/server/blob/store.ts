// The blob store (#33; architecture, decision 8): put and read a file by id.
// A file adapter on a disk volume now; an S3 adapter can replace it without
// touching the callers. Who may read a file is decided by its caller, never
// here: there are no direct links to files. A large file — a video, #117 —
// is written as it arrives and read in pieces, never held whole in memory.
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { eq, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { blob } from "../db/schema";
import { env } from "../env";

/** An open stored file: its size, and one stream of its bytes or a close. */
export interface BlobReader {
  size: number;
  /** Bytes from `start` to `end`, both included; the whole file by default. Closes the file when the stream ends or is cancelled. */
  stream(range?: { start: number; end: number }): ReadableStream<Uint8Array>;
  /** Closes the file when no stream is read from it. */
  close(): Promise<void>;
}

export interface BlobStore {
  put(id: string, bytes: Uint8Array): Promise<void>;
  /**
   * Writes the chunks as they come and returns the size, or "too_big" as soon
   * as they pass `limit`: then nothing is kept and the rest is not read.
   */
  putStream(id: string, chunks: AsyncIterable<Uint8Array>, limit: number): Promise<number | "too_big">;
  read(id: string): Promise<Uint8Array | null>;
  /** Opens a file for reading in pieces; null when it is not there. */
  open(id: string): Promise<BlobReader | null>;
  /** Removes the file; a file that is not there is not an error. */
  remove(id: string): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Files named by their id in one directory. The id is a UUID, so it cannot leave the directory. */
export function fileStore(dir: string): BlobStore {
  const path = (id: string) => {
    if (!UUID.test(id)) throw new Error("fileStore: not a blob id");
    return join(dir, id);
  };
  return {
    async put(id, bytes) {
      await mkdir(dir, { recursive: true });
      // Written aside and renamed, so a reader never sees half a file.
      const partial = `${path(id)}.partial`;
      await writeFile(partial, bytes, { flag: "wx" });
      await rename(partial, path(id));
    },
    async putStream(id, chunks, limit) {
      await mkdir(dir, { recursive: true });
      const partial = `${path(id)}.partial`;
      const file = await open(partial, "wx");
      let size = 0;
      let kept = false;
      try {
        // Leaving the loop early cancels the source: an oversized upload is not read to its end.
        for await (const chunk of chunks) {
          size += chunk.byteLength;
          if (size > limit) return "too_big";
          await file.write(chunk);
        }
        await file.close();
        await rename(partial, path(id));
        kept = true;
        return size;
      } finally {
        if (!kept) {
          await file.close().catch(() => {});
          await rm(partial, { force: true });
        }
      }
    },
    async remove(id) {
      await rm(path(id), { force: true });
    },
    async open(id) {
      let file: Awaited<ReturnType<typeof open>>;
      try {
        file = await open(path(id), "r");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
      // The size of the file this handle holds, even if the name is removed meanwhile.
      const { size } = await file.stat();
      return {
        size,
        stream(range) {
          const nodeStream = file.createReadStream(range ? { start: range.start, end: range.end } : {});
          return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
        },
        close: () => file.close(),
      };
    },
    async read(id) {
      try {
        return new Uint8Array(await readFile(path(id)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
  };
}

let cached: BlobStore | undefined;

export function blobStore(): BlobStore {
  cached ??= fileStore(env().FILES_DIR);
  return cached;
}

/** Keeps a file of this teacher and returns its id. The bytes go first: a row never points at nothing. */
export async function saveBlob(db: Database, teacherId: string, bytes: Uint8Array, contentType: string): Promise<string> {
  const id = crypto.randomUUID();
  await blobStore().put(id, bytes);
  await db.insert(blob).values({ id, teacherId, contentType, size: bytes.byteLength });
  return id;
}

/** How many bytes a stream upload reads before it decides the file's type. */
const HEAD_BYTES = 64;

/**
 * Keeps a file of this teacher that arrives as a stream (#117) and returns
 * its id. Its type comes from its first bytes: `sniff` names it or refuses
 * it before anything is written. Past `limit` bytes the upload stops and
 * nothing is kept. The bytes go first, then the row, as in saveBlob.
 */
export async function saveBlobStream(
  db: Database,
  teacherId: string,
  body: ReadableStream<Uint8Array>,
  { limit, sniff }: { limit: number; sniff: (head: Uint8Array) => string | null },
): Promise<string | "too_big" | "unsupported"> {
  const reader = body.getReader();
  try {
    const first: Uint8Array[] = [];
    let headSize = 0;
    let ended = false;
    while (headSize < HEAD_BYTES) {
      const { done, value } = await reader.read();
      if (done) {
        ended = true;
        break;
      }
      first.push(value);
      headSize += value.byteLength;
    }
    const head = new Uint8Array(Buffer.concat(first));
    const contentType = sniff(head);
    if (!contentType) return "unsupported";

    async function* chunks() {
      yield head;
      if (ended) return;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    }
    const id = crypto.randomUUID();
    const size = await blobStore().putStream(id, chunks(), limit);
    if (size === "too_big") return "too_big";
    await db.insert(blob).values({ id, teacherId, contentType, size });
    return id;
  } finally {
    // Whatever was not read — a refused or oversized upload — is dropped, not buffered.
    await reader.cancel().catch(() => {});
  }
}

/** A stored file of this teacher, open for reading in pieces (#117), or null. */
export async function openBlob(
  db: Database,
  teacherId: string,
  id: string,
): Promise<{ reader: BlobReader; contentType: string } | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db.select({ teacherId: blob.teacherId, contentType: blob.contentType }).from(blob).where(eq(blob.id, id));
  if (!row || row.teacherId !== teacherId) return null;
  const reader = await blobStore().open(id);
  return reader ? { reader, contentType: row.contentType } : null;
}

/** A file of this teacher, or null. */
export async function readBlob(
  db: Database,
  teacherId: string,
  id: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db.select({ teacherId: blob.teacherId, contentType: blob.contentType }).from(blob).where(eq(blob.id, id));
  if (!row || row.teacherId !== teacherId) return null;
  const bytes = await blobStore().read(id);
  return bytes ? { bytes, contentType: row.contentType } : null;
}

/**
 * How long a file nothing refers to is kept (#73): an import or an upload
 * stores the file before the row that refers to it, so a young file may be
 * one whose reference is on its way.
 */
export const BLOB_GRACE_HOURS = 24;

/**
 * Removes the files nothing refers to (#73): no homework document and no
 * task of the task bank (#224) of any teacher names it as "blob:<id>" (a picture), no answer as its file (a
 * recording or a photo), no library material as its file (a game or a warm-up picture, #115, #116), no textbook as a book, a track or a page (#156),
 * no parent's report as a recording «было» or «стало» (#269), no assessment as its recording or picture (#252), and
 * it is older than the grace period. A file can
 * belong to more than one homework — a new assistant draft keeps the old
 * one's pictures — so every reference counts. The rows go in one statement,
 * which sees the references as they are at that moment, then the files.
 * Returns how many files went and their size, never which.
 */
export async function removeUnreferencedBlobs(
  db: Database,
  now: Date = new Date(),
): Promise<{ removed: number; bytes: number }> {
  const before = new Date(now.getTime() - BLOB_GRACE_HOURS * 3_600_000);
  const rows = await db.execute<{ id: string; size: number }>(sql`
    DELETE FROM blob AS b
    WHERE b.created_at < ${before.toISOString()}
      AND NOT EXISTS (
        SELECT 1 FROM (
          SELECT h.document -> 'tasks' AS tasks FROM homework AS h
          -- The task bank's confirmed tasks and drafts (#224).
          UNION ALL SELECT t.tasks FROM textbook_lesson_tasks AS t
          UNION ALL SELECT t.draft FROM textbook_lesson_tasks AS t
        ) AS list, jsonb_array_elements(coalesce(list.tasks, '[]'::jsonb)) AS task
        WHERE task ->> 'image' = 'blob:' || b.id::text OR task ->> 'audio' = 'blob:' || b.id::text
          -- The pictures of answer options (#129).
          OR jsonb_path_exists(task, '$.options[*].images[*] ? (@ == $ref)', jsonb_build_object('ref', 'blob:' || b.id::text))
          -- And of the gaps (#181).
          OR jsonb_path_exists(task, '$.gapImages[*] ? (@ == $ref)', jsonb_build_object('ref', 'blob:' || b.id::text))
          -- And of the left side of match pairs (#184).
          OR jsonb_path_exists(task, '$.pairs[*].left.images[*] ? (@ == $ref)', jsonb_build_object('ref', 'blob:' || b.id::text))
          -- And of a table's header (#186).
          OR jsonb_path_exists(task, '$.header[*].images[*] ? (@ == $ref)', jsonb_build_object('ref', 'blob:' || b.id::text))
      )
      AND NOT EXISTS (
        SELECT 1 FROM homework_answer AS a
        WHERE a.answer ->> 'file' = b.id::text
      )
      AND NOT EXISTS (
        SELECT 1 FROM library_material AS m
        WHERE m.blob_id = b.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM textbook_file AS f
        WHERE f.blob_id = b.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM textbook_page AS p
        WHERE p.blob_id = b.id
      )
      -- A report's recordings (#269).
      AND NOT EXISTS (
        SELECT 1 FROM report AS r
        WHERE r.recording_before = b.id OR r.recording_after = b.id
      )
      -- An assessment's recording and picture (#252).
      AND NOT EXISTS (
        SELECT 1 FROM assessment AS s
        WHERE s.listening_recording = b.id OR s.speaking_picture = b.id
      )
    RETURNING b.id, b.size
  `);
  const removed = [...rows] as { id: string; size: number | string }[];
  for (const row of removed) await blobStore().remove(row.id);
  return { removed: removed.length, bytes: removed.reduce((sum, row) => sum + Number(row.size), 0) };
}
