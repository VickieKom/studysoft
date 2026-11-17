// Serving a library material's file (#115) and uploading an own video (#117).
// A game is served to its teacher, and to a student it is open to (#118), as
// a page that runs sandboxed — scripts allowed, but in an origin of its own,
// so it cannot reach the platform's pages, cookies or storage, whether it is
// framed or opened by its address. A video is served in byte ranges, so it
// plays in Safari, and read from the store in pieces. A missing material,
// another teacher's, a video link (no file), a game not open to this student
// and no session all answer the same 404.
import { GAME_SANDBOX, MAX_VIDEO_BYTES } from "../../domain/library";
import { teacherIdFromHeaders } from "../access/auth";
import { linkSessionFromHeaders } from "../access/links";
import { byteRange } from "../blob/range";
import { saveBlobStream } from "../blob/store";
import { type Database, db } from "../db/client";
import { materialFile, sniffVideo } from "./library";
import { studentGame } from "./student-games";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const notFound = () =>
  new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

/** A refusal the teacher reads: the status and the message the form shows. */
const refused = (status: number, error: string) =>
  Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

/** Whose library to read the file from: the teacher's own, or a student's teacher when the game is open to that student. */
async function owner(database: Database, headers: Headers, id: string): Promise<string | null> {
  const teacherId = await teacherIdFromHeaders(headers);
  if (teacherId) return teacherId;
  const session = await linkSessionFromHeaders(database, headers, "student");
  if (session?.role !== "student") return null;
  return (await studentGame(database, session.teacherId, session.studentId, id)) ? session.teacherId : null;
}

export async function handleLibraryFileRequest(request: Request, id: string): Promise<Response> {
  if (!UUID.test(id)) return notFound();
  const database = db();
  const teacherId = await owner(database, request.headers, id.toLowerCase());
  if (!teacherId) return notFound();
  const file = await materialFile(database, teacherId, id.toLowerCase());
  if (!file) return notFound();
  const { reader } = file;

  const caching = { ETag: `"${file.blobId}"`, "Cache-Control": "private, no-cache" };
  if (request.headers.get("If-None-Match") === caching.ETag) {
    await reader.close();
    return new Response(null, { status: 304, headers: caching });
  }
  const headers = {
    ...caching,
    "Content-Type": file.contentType,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
    // The sandbox holds when the address is opened directly, not only in the frame.
    "Content-Security-Policy": `sandbox ${GAME_SANDBOX}`,
    "Referrer-Policy": "no-referrer",
  };
  const size = reader.size;
  const range = byteRange(request.headers.get("Range"), size);
  if (range === "unsatisfiable") {
    await reader.close();
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  }
  if (range) {
    return new Response(reader.stream(range), {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        "Content-Length": String(range.end - range.start + 1),
      },
    });
  }
  return new Response(reader.stream(), { headers: { ...headers, "Content-Length": String(size) } });
}

/**
 * Keeps an own video's file (#117) and answers its id; the material is saved
 * after it, with its tags, by `teacher.library.addVideoFile`. The file is
 * written to the store as it arrives: past 200 MB the upload stops and
 * nothing is kept. The type comes from the first bytes: MP4, WebM or MOV.
 */
export async function handleLibraryVideoUpload(request: Request): Promise<Response> {
  const teacherId = await teacherIdFromHeaders(request.headers);
  if (!teacherId) return notFound();
  const tooBig = () => refused(413, "Файл больше 200 МБ");
  if (Number(request.headers.get("Content-Length") ?? "0") > MAX_VIDEO_BYTES) return tooBig();
  const unsupported = () => refused(415, "Видео — MP4, WebM или MOV. Файл другого формата переведите в MP4");
  if (!request.body) return unsupported();

  const saved = await saveBlobStream(db(), teacherId, request.body, { limit: MAX_VIDEO_BYTES, sniff: sniffVideo });
  if (saved === "too_big") return tooBig();
  if (saved === "unsupported") return unsupported();
  return Response.json({ file: saved }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
