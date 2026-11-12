// The blob store (#33; architecture, decision 8): put and read a file by id.
// A file adapter on a disk volume now; an S3 adapter can replace it without
// touching the callers. Who may read a file is decided by its caller, never
// here: there are no direct links to files.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { blob } from "../db/schema";
import { env } from "../env";

export interface BlobStore {
  put(id: string, bytes: Uint8Array): Promise<void>;
  read(id: string): Promise<Uint8Array | null>;
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
  // shortcut: files nothing refers to (a failed import, a replaced or removed picture) stay until cleanup exists (#73)
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
