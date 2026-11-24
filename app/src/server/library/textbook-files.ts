// Uploading a textbook's files and serving them (#156). A book (PDF) or a
// track is uploaded with PUT before its set is saved, written to the store as
// it arrives and stopped at its limit, and so is a video (#329). A book, a
// track and a rendered page are served to their teacher only, in byte ranges;
// a video also to a student it is open to; anyone else — a student, a parent,
// another teacher, no session — gets the same 404 as for a missing one.
import { MAX_VIDEO_BYTES } from "../../domain/library";
import { MAX_BOOK_BYTES, MAX_TRACKS_BYTES } from "../../domain/textbook";
import { teacherIdFromHeaders } from "../access/auth";
import { linkSessionFromHeaders } from "../access/links";
import { byteRange } from "../blob/range";
import { openBlob, saveBlobStream } from "../blob/store";
import { db } from "../db/client";
import { sniffVideo } from "./library";
import { isTextbookVideoOpen } from "./textbook-videos";
import { sniffPdf, sniffTrack, textbookBlob } from "./textbooks";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = /^[1-9]\d{0,4}$/;

const notFound = () =>
  new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

/** A refusal the teacher reads: the status and the message the form shows. */
const refused = (status: number, error: string) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Keeps a book (`kind=book`) or a track (`kind=track`) and answers its id;
 * the set is saved after its files by `teacher.textbooks.create`. The type
 * comes from the first bytes.
 */
export async function handleTextbookUpload(request: Request): Promise<Response> {
  const teacherId = await teacherIdFromHeaders(request.headers);
  if (!teacherId) return notFound();
  const kind = new URL(request.url).searchParams.get("kind");
  if (kind === "video") return uploadVideo(request, teacherId);
  if (kind !== "book" && kind !== "track") return notFound();
  const book = kind === "book";
  const limit = book ? MAX_BOOK_BYTES : MAX_TRACKS_BYTES;
  const tooBig = () => refused(413, book ? "Книга больше 300 МБ" : "Треки вместе больше 500 МБ");
  if (Number(request.headers.get("Content-Length") ?? "0") > limit) return tooBig();
  const unsupported = () =>
    refused(415, book ? "Книга — файл PDF. Этот файл не PDF" : "Трек — MP3, M4A, WAV или OGG. Этот файл другого формата");
  if (!request.body) return unsupported();

  const saved = await saveBlobStream(db(), teacherId, request.body, { limit, sniff: book ? sniffPdf : sniffTrack });
  if (saved === "too_big") return tooBig();
  if (saved === "unsupported") return unsupported();
  return Response.json({ file: saved }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

/** A set's video (#329): MP4, WebM or MOV by its first bytes, at most 200 MB, as a library video is (#117). */
async function uploadVideo(request: Request, teacherId: string): Promise<Response> {
  const tooBig = () => refused(413, "Видео больше 200 МБ");
  if (Number(request.headers.get("Content-Length") ?? "0") > MAX_VIDEO_BYTES) return tooBig();
  const unsupported = () => refused(415, "Видео — MP4, WebM или MOV. Файл другого формата переведите в MP4");
  if (!request.body) return unsupported();
  const saved = await saveBlobStream(db(), teacherId, request.body, { limit: MAX_VIDEO_BYTES, sniff: sniffVideo });
  if (saved === "too_big") return tooBig();
  if (saved === "unsupported") return unsupported();
  return Response.json({ file: saved }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

/**
 * A book, a track or a video (`page` null), or a rendered page of a book, for
 * its teacher; a video also for a student it is open to from a lesson's
 * preparation (#329).
 */
export async function handleTextbookFileRequest(request: Request, fileId: string, page: string | null): Promise<Response> {
  if (!UUID.test(fileId) || (page !== null && !PAGE.test(page))) return notFound();
  const database = db();
  let teacherId = await teacherIdFromHeaders(request.headers);
  if (!teacherId && page === null) {
    const session = await linkSessionFromHeaders(database, request.headers, "student");
    if (session?.role === "student" && (await isTextbookVideoOpen(database, session.teacherId, session.studentId, fileId.toLowerCase()))) {
      teacherId = session.teacherId;
    }
  }
  if (!teacherId) return notFound();
  const blobId = await textbookBlob(database, teacherId, fileId.toLowerCase(), page === null ? null : Number(page));
  const file = blobId ? await openBlob(database, teacherId, blobId) : null;
  if (!file || !blobId) return notFound();
  const { reader } = file;

  // A file never changes under its id: the ETag is the stored file's.
  const caching = { ETag: `"${blobId}"`, "Cache-Control": "private, no-cache" };
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
      headers: { ...headers, "Content-Range": `bytes ${range.start}-${range.end}/${size}`, "Content-Length": String(range.end - range.start + 1) },
    });
  }
  return new Response(reader.stream(), { headers: { ...headers, "Content-Length": String(size) } });
}
