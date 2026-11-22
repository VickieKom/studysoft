// The recording for «Аудирование» and the picture for «Говорение» of an
// assessment (#252). The teacher uploads each with PUT to its own address
// while the assessment is a draft and removes it with DELETE; both are kept
// in the blob store and served at the same address to the teacher only —
// the child's page arrives with #253. Everyone else gets the same 404 as a
// missing file (architecture 8.1).
import { and, eq } from "drizzle-orm";
import { ASSESSMENT_FILES, type AssessmentFile, MAX_ASSESSMENT_PICTURE_BYTES, MAX_ASSESSMENT_RECORDING_BYTES, assessmentFileUrl } from "../../domain/assessment";
import { AUDIO_TYPES, IMAGE_TYPES } from "../../domain/homework-format";
import { teacherIdFromHeaders } from "../access/auth";
import { byteRange } from "../blob/range";
import { readBlob, saveBlobStream } from "../blob/store";
import { db } from "../db/client";
import { assessment } from "../db/schema";
import { sniffMedia } from "../homework/media";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
const refused = (status: number, error: string) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
const isFile = (value: string): value is AssessmentFile => (ASSESSMENT_FILES as readonly string[]).includes(value);

const RULES = {
  listening: {
    types: AUDIO_TYPES as readonly string[],
    limit: MAX_ASSESSMENT_RECORDING_BYTES,
    tooBig: "Запись больше 10 МБ. Выберите файл поменьше",
    wrongType: "Можно загрузить аудио: MP3, M4A, WAV или OGG",
  },
  picture: {
    types: IMAGE_TYPES as readonly string[],
    limit: MAX_ASSESSMENT_PICTURE_BYTES,
    tooBig: "Картинка больше 2 МБ. Выберите файл поменьше",
    wrongType: "Можно загрузить картинку: PNG, JPEG или WebP",
  },
} as const;

const column = (which: AssessmentFile) => (which === "listening" ? assessment.listeningRecording : assessment.speakingPicture);
const setTo = (which: AssessmentFile, value: string | null) => (which === "listening" ? { listeningRecording: value } : { speakingPicture: value });

/** «Запись для аудирования» or «Картинка для говорения»: the teacher's file replaces the one before, while the assessment is a draft. */
export async function handleAssessmentFileUpload(request: Request, assessmentId: string, which: string): Promise<Response> {
  if (!UUID.test(assessmentId) || !isFile(which)) return notFound();
  const teacherId = await teacherIdFromHeaders(request.headers);
  if (!teacherId) return notFound();
  const database = db();
  const id = assessmentId.toLowerCase();
  const [found] = await database
    .select({ status: assessment.status })
    .from(assessment)
    .where(and(eq(assessment.id, id), eq(assessment.teacherId, teacherId)));
  if (!found || !request.body) return notFound();
  if (found.status !== "draft") return refused(409, "Замер уже утверждён");

  const rule = RULES[which];
  // shortcut: the type is checked by the first bytes only, a video in an M4A container passes; the teacher's own upload, check the tracks if it matters (#252)
  const saved = await saveBlobStream(database, teacherId, request.body, {
    limit: rule.limit,
    sniff: (head) => {
      const media = sniffMedia(head);
      return media && rule.types.includes(media.contentType) ? media.contentType : null;
    },
  });
  if (saved === "too_big") return refused(413, rule.tooBig);
  if (saved === "unsupported") return refused(415, rule.wrongType);
  // Conditional on the draft: an approval in between keeps the file it was approved with.
  const rows = await database
    .update(assessment)
    .set({ ...setTo(which, saved), updatedAt: new Date() })
    .where(and(eq(assessment.id, id), eq(assessment.teacherId, teacherId), eq(assessment.status, "draft")))
    .returning({ id: assessment.id });
  if (rows.length === 0) return refused(409, "Замер уже утверждён");
  return Response.json({ url: assessmentFileUrl(id, which) }, { headers: { "Cache-Control": "no-store" } });
}

/** «Убрать запись» / «Убрать картинку»: the draft has no such file any more. */
export async function handleAssessmentFileRemove(request: Request, assessmentId: string, which: string): Promise<Response> {
  if (!UUID.test(assessmentId) || !isFile(which)) return notFound();
  const teacherId = await teacherIdFromHeaders(request.headers);
  if (!teacherId) return notFound();
  const rows = await db()
    .update(assessment)
    .set({ ...setTo(which, null), updatedAt: new Date() })
    .where(and(eq(assessment.id, assessmentId.toLowerCase()), eq(assessment.teacherId, teacherId), eq(assessment.status, "draft")))
    .returning({ id: assessment.id });
  return rows.length > 0 ? new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } }) : notFound();
}

/** Serves an assessment's recording or picture to its teacher. */
export async function handleAssessmentFileRequest(request: Request, assessmentId: string, which: string): Promise<Response> {
  if (!UUID.test(assessmentId) || !isFile(which)) return notFound();
  const teacherId = await teacherIdFromHeaders(request.headers);
  if (!teacherId) return notFound();
  const database = db();
  const [row] = await database
    .select({ file: column(which) })
    .from(assessment)
    .where(and(eq(assessment.id, assessmentId.toLowerCase()), eq(assessment.teacherId, teacherId)));
  const file = row?.file ? await readBlob(database, teacherId, row.file) : null;
  if (!file || !row?.file) return notFound();

  // A new file replaces the old one at the same address; the ETag is the stored file's id.
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
