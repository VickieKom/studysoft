// Pictures (#33) and recordings (#127) in homework tasks. A file arrives as a
// data URL inside the homework JSON, is checked and kept in the blob store,
// and the stored document refers to it as "blob:<id>"; the same file in
// several tasks of one homework is kept once. It is served only after a
// permission check: the teacher who owns the homework, or the student whose
// published homework it is (architecture 8.1). Everything else is the same 404.
import { and, eq } from "drizzle-orm";
import {
  type AudioType,
  audioDataUrl,
  type HomeworkDocument,
  type ImageType,
  imageDataUrl,
  imageRef,
  type Task,
} from "../../domain/homework-format";
import { teacherIdFromHeaders } from "../access/auth";
import { linkSessionFromHeaders } from "../access/links";
import { readBlob, saveBlob } from "../blob/store";
import { byteRange } from "./answer-files";
import { type Database, db } from "../db/client";
import { homework } from "../db/schema";

/** The first bytes of each accepted type: a data URL that lies about its type is refused. */
function looksLike(type: ImageType, bytes: Uint8Array): boolean {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  switch (type) {
    case "image/png":
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "image/webp":
      return starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  }
}

/** The first bytes of each accepted recording type (#127): MP3 frames or an ID3 tag, an ISO box, RIFF WAVE, Ogg. */
function looksLikeAudio(type: AudioType, bytes: Uint8Array): boolean {
  const ascii = (offset: number, length: number) => String.fromCharCode(...bytes.slice(offset, offset + length));
  switch (type) {
    case "audio/mpeg":
      return ascii(0, 3) === "ID3" || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0);
    case "audio/mp4":
      return ascii(4, 4) === "ftyp";
    case "audio/wav":
      return ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE";
    case "audio/ogg":
      return ascii(0, 4) === "OggS";
  }
}

export type StoreResult = { ok: true; homework: HomeworkDocument } | { ok: false; errors: string[] };

/**
 * Keeps the new pictures and recordings of a validated homework and replaces
 * them with references. A reference may stay only if `keep` has it: the
 * files already in this draft. The same data in several tasks is stored once.
 * Nothing is stored unless every file is fine.
 */
export async function storeTaskFiles(
  database: Database,
  teacherId: string,
  document: HomeworkDocument,
  keep: ReadonlySet<string>,
): Promise<StoreResult> {
  const errors: string[] = [];
  const decoded = new Map<string, { type: string; bytes: Uint8Array }>();
  for (const [index, task] of document.tasks.entries()) {
    for (const field of ["image", "audio"] as const) {
      const value = task[field];
      if (!value) continue;
      const ref = imageRef(value);
      if (ref !== null) {
        if (!keep.has(ref)) {
          errors.push(
            field === "image"
              ? `Задание ${index + 1}, поле image: вставьте картинку как data:image/…;base64,…`
              : `Задание ${index + 1}, поле audio: вставьте запись как data:audio/…;base64,…`,
          );
        }
        continue;
      }
      if (decoded.has(value)) continue;
      if (field === "image") {
        const data = imageDataUrl(value);
        const bytes = data ? new Uint8Array(Buffer.from(data.base64, "base64")) : null;
        if (!data || !bytes || !looksLike(data.type, bytes)) {
          errors.push(`Задание ${index + 1}, поле image: это не картинка ${data?.type.slice(6).toUpperCase() ?? ""}`.trim());
          continue;
        }
        decoded.set(value, { type: data.type, bytes });
      } else {
        const data = audioDataUrl(value);
        const bytes = data ? new Uint8Array(Buffer.from(data.base64, "base64")) : null;
        if (!data || !bytes || !looksLikeAudio(data.type, bytes)) {
          errors.push(`Задание ${index + 1}, поле audio: это не запись MP3, M4A, WAV или OGG`);
          continue;
        }
        decoded.set(value, { type: data.type, bytes });
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const stored = new Map<string, string>();
  for (const [value, file] of decoded) stored.set(value, `blob:${await saveBlob(database, teacherId, file.bytes, file.type)}`);
  const tasks: Task[] = document.tasks.map((task) => ({
    ...task,
    ...(task.image && stored.has(task.image) ? { image: stored.get(task.image)! } : {}),
    ...(task.audio && stored.has(task.audio) ? { audio: stored.get(task.audio)! } : {}),
  }));
  return { ok: true, homework: { ...document, tasks } };
}

/** The references to stored pictures and recordings in a homework. */
export function taskFileRefs(document: HomeworkDocument): Set<string> {
  return new Set(
    document.tasks.flatMap((task) => [task.image, task.audio].flatMap((value) => (value && imageRef(value) ? [imageRef(value)!] : []))),
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/**
 * Serves a task's picture, or its recording (#127). The teacher who owns the homework sees it in any
 * status; a student only in their own published homework. A missing task, a
 * foreign homework, a draft and no session all answer the same 404.
 */
export async function handleHomeworkImageRequest(
  request: Request,
  homeworkId: string,
  taskIndex: string,
  part: "image" | "audio" = "image",
): Promise<Response> {
  if (!UUID.test(homeworkId) || !/^(0|[1-9]\d{0,2})$/.test(taskIndex)) return notFound();
  const database = db();

  let owner: { teacherId: string; studentId?: string } | null = null;
  const teacherId = await teacherIdFromHeaders(request.headers);
  if (teacherId) owner = { teacherId };
  else {
    const session = await linkSessionFromHeaders(database, request.headers, "student");
    if (session?.role === "student") owner = { teacherId: session.teacherId, studentId: session.studentId };
  }
  if (!owner) return notFound();

  const [row] = await database
    .select({ document: homework.document })
    .from(homework)
    .where(
      and(
        eq(homework.id, homeworkId),
        eq(homework.teacherId, owner.teacherId),
        ...(owner.studentId ? [eq(homework.studentId, owner.studentId), eq(homework.status, "published")] : []),
      ),
    );
  const value = (row?.document as HomeworkDocument | undefined)?.tasks[Number(taskIndex)]?.[part];
  const ref = value ? imageRef(value) : null;
  const file = ref ? await readBlob(database, owner.teacherId, ref) : null;
  if (!file || !ref) return notFound();

  // The address names a task's position, not a file: reordering or replacing
  // puts another file there. The browser keeps a copy but asks every time;
  // the ETag is the file's id, so an unchanged picture costs a 304.
  const caching = { ETag: `"${ref}"`, "Cache-Control": "private, no-cache" };
  if (request.headers.get("If-None-Match") === caching.ETag) return new Response(null, { status: 304, headers: caching });
  const headers = {
    ...caching,
    "Content-Type": file.contentType,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
  };
  // A player seeks in a recording with byte ranges, and Safari plays audio only from a server that answers them.
  const size = file.bytes.byteLength;
  const range = part === "audio" ? byteRange(request.headers.get("Range"), size) : null;
  if (range === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  }
  if (range) {
    return new Response(Buffer.from(file.bytes.subarray(range.start, range.end + 1)), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${range.start}-${range.end}/${size}`, "Content-Length": String(range.end - range.start + 1) },
    });
  }
  return new Response(Buffer.from(file.bytes), { headers: { ...headers, "Content-Length": String(size) } });
}
