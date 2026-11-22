// The recording for «Аудирование» and the picture for «Говорение» of an
// assessment (#252). The teacher uploads each with PUT to its own address
// while the assessment is a draft and removes it with DELETE; both are kept
// in the blob store and served at the same address to the teacher, and to
// the child while the assessment is open to them in a lesson (#253): the
// recording while plays are left. The speaking recording (#253) is made on
// the teacher's lesson panel, at most 5 minutes, while the approved
// assessment is not ended, and is served to the teacher only. Everyone else
// gets the same 404 as a missing file (architecture 8.1).
import { and, eq, isNull } from "drizzle-orm";
import { ASSESSMENT_FILES, type AssessmentFile, MAX_ASSESSMENT_PICTURE_BYTES, MAX_ASSESSMENT_RECORDING_BYTES, assessmentFileUrl } from "../../domain/assessment";
import { AUDIO_TYPES, IMAGE_TYPES } from "../../domain/homework-format";
import { MAX_SPEAKING_SECONDS } from "../../domain/assessment-answers";
import { teacherIdFromHeaders } from "../access/auth";
import { linkSessionFromHeaders } from "../access/links";
import { byteRange } from "../blob/range";
import { readBlob, saveBlob, saveBlobStream } from "../blob/store";
import { db } from "../db/client";
import { assessment } from "../db/schema";
import { readLimited } from "../homework/answer-files";
import { isAudioOnly, sniffMedia, VOICE_TYPES, voiceDuration } from "../homework/media";
import { TEACHER_EDITED } from "./assessments";
import { listeningOpenToChild, pictureOpenToChild } from "./taking";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
const refused = (status: number, error: string) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
const isFile = (value: string): value is AssessmentFile => (ASSESSMENT_FILES as readonly string[]).includes(value);

/** The draft's own files, uploaded on the card. */
type DraftFile = Exclude<AssessmentFile, "speaking">;

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

const column = (which: AssessmentFile) =>
  which === "listening" ? assessment.listeningRecording : which === "picture" ? assessment.speakingPicture : assessment.speakingRecording;
const setTo = (which: DraftFile, value: string | null) => (which === "listening" ? { listeningRecording: value } : { speakingPicture: value });
/** A second over the limit is allowed: the browser stops a little late. */
const SPEAKING_TOLERANCE_SECONDS = 1;
const MAX_SPEAKING_BYTES = MAX_ASSESSMENT_RECORDING_BYTES;

/**
 * «Остановить» on the lesson panel: the speaking recording from the
 * teacher's microphone, kept with the approved assessment while it is not
 * ended; a new one replaces the one before. Its length is read from the
 * container, as a homework voice answer's.
 */
async function uploadSpeaking(request: Request, teacherId: string, id: string): Promise<Response> {
  const database = db();
  const ongoing = and(eq(assessment.id, id), eq(assessment.teacherId, teacherId), eq(assessment.status, "approved"), isNull(assessment.finishedAt));
  const [found] = await database.select({ id: assessment.id }).from(assessment).where(ongoing);
  if (!found) return notFound();
  const bytes = await readLimited(request, MAX_SPEAKING_BYTES);
  if (!bytes) return refused(413, "Запись больше 10 МБ. Запишите покороче");
  const media = sniffMedia(bytes);
  if (!media || !(VOICE_TYPES as readonly string[]).includes(media.contentType) || !isAudioOnly(bytes, media.contentType)) {
    return refused(415, "Не получилось сохранить запись. Попробуйте записать ещё раз");
  }
  const seconds = voiceDuration(bytes, media.contentType);
  if (seconds === null) return refused(415, "Не получилось сохранить запись. Попробуйте записать ещё раз");
  if (seconds > MAX_SPEAKING_SECONDS + SPEAKING_TOLERANCE_SECONDS) return refused(413, "Запись длиннее 5 минут");
  const saved = await saveBlob(database, teacherId, bytes, media.contentType);
  // Conditional on the assessment not ended in between.
  const rows = await database.update(assessment).set({ speakingRecording: saved, updatedAt: new Date() }).where(ongoing).returning({ id: assessment.id });
  if (rows.length === 0) return refused(409, "Замер уже завершён");
  return Response.json({ url: assessmentFileUrl(id, "speaking") }, { headers: { "Cache-Control": "no-store" } });
}

/** «Запись для аудирования» or «Картинка для говорения»: the teacher's file replaces the one before, while the assessment is a draft. */
export async function handleAssessmentFileUpload(request: Request, assessmentId: string, which: string): Promise<Response> {
  if (!UUID.test(assessmentId) || !isFile(which)) return notFound();
  const teacherId = await teacherIdFromHeaders(request.headers);
  if (!teacherId) return notFound();
  const id = assessmentId.toLowerCase();
  if (which === "speaking") return uploadSpeaking(request, teacherId, id);
  const database = db();
  const [found] = await database
    .select({ status: assessment.status })
    .from(assessment)
    .where(and(eq(assessment.id, id), eq(assessment.teacherId, teacherId)));
  if (!found || !request.body) return notFound();
  if (found.status !== "draft") return refused(409, "Замер уже утверждён");

  const rule = RULES[which as DraftFile];
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
    .set({ ...setTo(which as DraftFile, saved), teacherEditedAt: TEACHER_EDITED, updatedAt: new Date() })
    .where(and(eq(assessment.id, id), eq(assessment.teacherId, teacherId), eq(assessment.status, "draft")))
    .returning({ id: assessment.id });
  if (rows.length === 0) return refused(409, "Замер уже утверждён");
  return Response.json({ url: assessmentFileUrl(id, which) }, { headers: { "Cache-Control": "no-store" } });
}

/** «Убрать запись» / «Убрать картинку»: the draft has no such file any more. */
export async function handleAssessmentFileRemove(request: Request, assessmentId: string, which: string): Promise<Response> {
  if (!UUID.test(assessmentId) || !isFile(which) || which === "speaking") return notFound();
  const teacherId = await teacherIdFromHeaders(request.headers);
  if (!teacherId) return notFound();
  const rows = await db()
    .update(assessment)
    .set({ ...setTo(which, null), teacherEditedAt: TEACHER_EDITED, updatedAt: new Date() })
    .where(and(eq(assessment.id, assessmentId.toLowerCase()), eq(assessment.teacherId, teacherId), eq(assessment.status, "draft")))
    .returning({ id: assessment.id });
  return rows.length > 0 ? new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } }) : notFound();
}

/** The teacher's file, or the child's while the assessment is open to them: whose it is and the stored file's id. */
async function servedFile(headers: Headers, id: string, which: AssessmentFile): Promise<{ teacherId: string; file: string } | null> {
  const database = db();
  const teacherId = await teacherIdFromHeaders(headers);
  if (teacherId) {
    const [row] = await database
      .select({ file: column(which) })
      .from(assessment)
      .where(and(eq(assessment.id, id), eq(assessment.teacherId, teacherId)));
    return row?.file ? { teacherId, file: row.file } : null;
  }
  if (which === "speaking") return null;
  const session = await linkSessionFromHeaders(database, headers, "student");
  if (session?.role !== "student") return null;
  const file =
    which === "listening"
      ? await listeningOpenToChild(database, session.teacherId, session.studentId, id)
      : await pictureOpenToChild(database, session.teacherId, session.studentId, id);
  return file ? { teacherId: session.teacherId, file } : null;
}

/** Serves an assessment's file to its teacher, and the recording and the picture to the child while open (#253). */
export async function handleAssessmentFileRequest(request: Request, assessmentId: string, which: string): Promise<Response> {
  if (!UUID.test(assessmentId) || !isFile(which)) return notFound();
  const database = db();
  const row = await servedFile(request.headers, assessmentId.toLowerCase(), which);
  const file = row ? await readBlob(database, row.teacherId, row.file) : null;
  if (!file || !row) return notFound();

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
