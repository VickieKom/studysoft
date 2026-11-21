// The recordings «было» and «стало» of a parent's report (#269). The teacher
// uploads them with PUT to the recording's own address and removes them with
// DELETE; they are kept in the blob store. Served at the same address to the
// teacher, and to the parent of the student once the report is published.
// Everyone else — another parent, the student, no session — gets the same
// 404 as a missing recording (architecture 8.1).
import { and, eq } from "drizzle-orm";
import { MAX_RECORDING_BYTES, type Recording, RECORDINGS, reportRecordingUrl } from "../../domain/report";
import { teacherIdFromHeaders } from "../access/auth";
import { linkSessionFromHeaders } from "../access/links";
import { byteRange } from "../blob/range";
import { readBlob, saveBlobStream } from "../blob/store";
import { db } from "../db/client";
import { report } from "../db/schema";
import { sniffMedia } from "../homework/media";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** MP3, M4A, WAV, OGG (#269). */
const RECORDING_TYPES = ["audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg"];

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
const refused = (status: number, error: string) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

const column = (which: Recording) => (which === "before" ? report.recordingBefore : report.recordingAfter);
const isRecording = (value: string): value is Recording => (RECORDINGS as readonly string[]).includes(value);

/**
 * «Запись «было»» or «Запись «стало»»: keeps the teacher's file as the
 * report's recording, replacing the one before. Only the report's teacher
 * may upload; the type comes from the bytes.
 */
export async function handleReportRecordingUpload(request: Request, reportId: string, which: string): Promise<Response> {
  if (!UUID.test(reportId) || !isRecording(which)) return notFound();
  const teacherId = await teacherIdFromHeaders(request.headers);
  if (!teacherId) return notFound();
  const database = db();
  const id = reportId.toLowerCase();
  const [found] = await database.select({ id: report.id }).from(report).where(and(eq(report.id, id), eq(report.teacherId, teacherId)));
  if (!found || !request.body) return notFound();

  // shortcut: the type is checked by the first bytes only, a video in an M4A container passes; the teacher's own upload, check the tracks if it matters (#269)
  const saved = await saveBlobStream(database, teacherId, request.body, {
    limit: MAX_RECORDING_BYTES,
    sniff: (head) => {
      const media = sniffMedia(head);
      return media && RECORDING_TYPES.includes(media.contentType) ? media.contentType : null;
    },
  });
  if (saved === "too_big") return refused(413, "Запись больше 20 МБ. Выберите файл поменьше");
  if (saved === "unsupported") return refused(415, "Можно загрузить аудио: MP3, M4A, WAV или OGG");
  await database
    .update(report)
    .set(which === "before" ? { recordingBefore: saved } : { recordingAfter: saved })
    .where(and(eq(report.id, id), eq(report.teacherId, teacherId)));
  return Response.json({ url: reportRecordingUrl(id, which) }, { headers: { "Cache-Control": "no-store" } });
}

/** «Убрать запись»: the report has no such recording any more. */
export async function handleReportRecordingRemove(request: Request, reportId: string, which: string): Promise<Response> {
  if (!UUID.test(reportId) || !isRecording(which)) return notFound();
  const teacherId = await teacherIdFromHeaders(request.headers);
  if (!teacherId) return notFound();
  const rows = await db()
    .update(report)
    .set(which === "before" ? { recordingBefore: null } : { recordingAfter: null })
    .where(and(eq(report.id, reportId.toLowerCase()), eq(report.teacherId, teacherId)))
    .returning({ id: report.id });
  return rows.length > 0 ? new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } }) : notFound();
}

/** Serves a report's recording to its teacher, or to the student's parent once the report is published. */
export async function handleReportRecordingRequest(request: Request, reportId: string, which: string): Promise<Response> {
  if (!UUID.test(reportId) || !isRecording(which)) return notFound();
  const database = db();
  const teacherId = await teacherIdFromHeaders(request.headers);
  const parent = teacherId ? null : await linkSessionFromHeaders(database, request.headers, "parent");
  const owner = teacherId ? { teacherId } : parent?.role === "parent" ? parent : null;
  if (!owner) return notFound();
  const [row] = await database
    .select({ file: column(which) })
    .from(report)
    .where(
      and(
        eq(report.id, reportId.toLowerCase()),
        eq(report.teacherId, owner.teacherId),
        ...(parent ? [eq(report.studentId, parent.studentId), eq(report.status, "published")] : []),
      ),
    );
  const file = row?.file ? await readBlob(database, owner.teacherId, row.file) : null;
  if (!file || !row?.file) return notFound();

  // A new recording replaces the old one at the same address; the ETag is the stored file's id.
  const caching = { ETag: `"${row.file}"`, "Cache-Control": "private, no-cache" };
  if (request.headers.get("If-None-Match") === caching.ETag) return new Response(null, { status: 304, headers: caching });
  const headers = { ...caching, "Content-Type": file.contentType, "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" };
  // Safari plays audio only from a server that answers byte ranges.
  const size = file.bytes.byteLength;
  const range = byteRange(request.headers.get("Range"), size);
  if (range === "unsatisfiable") return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  if (range) {
    return new Response(Buffer.from(file.bytes.subarray(range.start, range.end + 1)), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${range.start}-${range.end}/${size}`, "Content-Length": String(range.end - range.start + 1) },
    });
  }
  return new Response(Buffer.from(file.bytes), { headers: { ...headers, "Content-Length": String(size) } });
}
