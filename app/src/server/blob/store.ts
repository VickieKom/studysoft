// The blob store (#33; architecture, decision 8): put and read a file by id.
// A file adapter on a disk volume now; an S3 adapter can replace it without
// touching the callers. Who may read a file is decided by its caller, never
// here: there are no direct links to files.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { blob } from "../db/schema";
import { env } from "../env";

export interface BlobStore {
  put(id: string, bytes: Uint8Array): Promise<void>;
  read(id: string): Promise<Uint8Array | null>;
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
    async remove(id) {
      await rm(path(id), { force: true });
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
 * Removes the files nothing refers to (#73): no homework document of any
 * teacher names it as "blob:<id>" (a picture), no answer as its file (a
 * recording or a photo), no library material as its file (a game, #115), and
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
        SELECT 1 FROM homework AS h, jsonb_array_elements(h.document -> 'tasks') AS task
        WHERE task ->> 'image' = 'blob:' || b.id::text
      )
      AND NOT EXISTS (
        SELECT 1 FROM homework_answer AS a
        WHERE a.answer ->> 'file' = b.id::text
      )
      AND NOT EXISTS (
        SELECT 1 FROM library_material AS m
        WHERE m.blob_id = b.id
      )
    RETURNING b.id, b.size
  `);
  const removed = [...rows] as { id: string; size: number | string }[];
  for (const row of removed) await blobStore().remove(row.id);
  return { removed: removed.length, bytes: removed.reduce((sum, row) => sum + Number(row.size), 0) };
}
