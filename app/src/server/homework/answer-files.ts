// A student's recording or file for a task (#35). Uploaded with PUT to the
// task's own address and kept in the blob store; the stored answer refers to
// it. Served at the same address after a permission check: the student whose
// homework it is, and their teacher. Everyone else gets the same 404 as a
// missing file (architecture 8.1).
import { and, eq, inArray } from "drizzle-orm";
import { answerFileUrl } from "../../domain/homework";
import {
  type HomeworkDocument,
  MAX_ANSWER_FILE_BYTES,
  MAX_VOICE_SECONDS,
  storedAnswerSchema,
} from "../../domain/homework-format";
import { teacherIdFromHeaders } from "../access/auth";
import { linkSessionFromHeaders } from "../access/links";
import { readBlob, saveBlob } from "../blob/store";
import { type Database, db } from "../db/client";
import { homework, homeworkAnswer } from "../db/schema";
import { publishedTask, saveFileAnswer } from "./homework";
import { isAudioOnly, sniffMedia, VOICE_TYPES, voiceDuration } from "./media";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TASK_INDEX = /^(0|[1-9]\d{0,2})$/;
// The same 404 as a missing homework picture: nothing tells "not yours" from "not there".
const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/** A refusal the student reads: the status and the message the page shows. */
const refused = (status: number, error: string) =>
  Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

// A recording's container may end a moment after the page stopped it at the limit.
const VOICE_TOLERANCE_SECONDS = 1;

/** The body, or null as soon as it grows past the limit: an oversized upload is never held whole. */
async function readLimited(request: Request, limit: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > limit) return null;
  if (!request.body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/**
 * Keeps a recording (a voice task) or a photo or audio file (a file task) as
 * the answer to a task of the student's published homework. Only the
 * student's own link session may upload. The type comes from the bytes, a
 * recording's length from its container; over the limits it is refused.
 */
export async function handleAnswerFileUpload(request: Request, homeworkId: string, taskIndex: string): Promise<Response> {
  if (!UUID.test(homeworkId) || !TASK_INDEX.test(taskIndex)) return notFound();
  const database = db();
  const session = await linkSessionFromHeaders(database, request.headers, "student");
  if (session?.role !== "student") return notFound();
  const { teacherId, studentId } = session;
  const index = Number(taskIndex);
  const id = homeworkId.toLowerCase();

  const task = await publishedTask(database, teacherId, studentId, id, index);
  if (!task || (task.type !== "voice" && task.type !== "file")) return notFound();

  const bytes = await readLimited(request, MAX_ANSWER_FILE_BYTES);
  if (!bytes) return refused(413, "Файл больше 10 МБ. Выберите файл поменьше");
  const media = sniffMedia(bytes);

  if (task.type === "voice") {
    // A video, even one with sound, is not a voice answer (#35: video is out of scope).
    if (!media || !(VOICE_TYPES as readonly string[]).includes(media.contentType) || !isAudioOnly(bytes, media.contentType)) {
      return refused(415, "Не получилось сохранить запись. Попробуйте записать ещё раз");
    }
    const seconds = voiceDuration(bytes, media.contentType);
    if (seconds === null) return refused(415, "Не получилось сохранить запись. Попробуйте записать ещё раз");
    if (seconds > MAX_VOICE_SECONDS + VOICE_TOLERANCE_SECONDS) {
      return refused(413, "Запись длиннее 5 минут. Запишите ответ покороче");
    }
  } else {
    const accept = task.accept ?? ["image", "audio"];
    if (!media || !accept.includes(media.kind) || (media.kind === "audio" && !isAudioOnly(bytes, media.contentType))) {
      return refused(
        415,
        accept.includes("audio") && accept.includes("image")
          ? "Можно прикрепить фото (JPEG, PNG, WebP) или аудио (MP3, M4A, WAV, OGG, WebM)"
          : accept.includes("image")
            ? "Можно прикрепить фото: JPEG, PNG или WebP"
            : "Можно прикрепить аудио: MP3, M4A, WAV, OGG или WebM",
      );
    }
  }

  const file = await saveBlob(database, teacherId, bytes, media.contentType);
  const saved = await saveFileAnswer(database, teacherId, studentId, id, index, {
    type: task.type,
    file,
    contentType: media.contentType,
  });
  // Submitted or taken back while the file was on its way.
  if (saved !== "saved") return notFound();
  return Response.json(
    { url: answerFileUrl(id, index), contentType: media.contentType },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Who asks: the teacher, or a student through their own link session. */
async function requester(database: Database, headers: Headers): Promise<{ teacherId: string; studentId?: string } | null> {
  const teacherId = await teacherIdFromHeaders(headers);
  if (teacherId) return { teacherId };
  const session = await linkSessionFromHeaders(database, headers, "student");
  return session?.role === "student" ? { teacherId: session.teacherId, studentId: session.studentId } : null;
}

/** One byte range of `size` bytes ("bytes=0-1", "bytes=100-", "bytes=-500"), or null when there is none to honour. */
function byteRange(header: string | null, size: number): { start: number; end: number } | "unsatisfiable" | null {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!match || (match[1] === "" && match[2] === "")) return null;
  let start: number;
  let end: number;
  if (match[1] === "") {
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  return start > end || start >= size ? "unsatisfiable" : { start, end };
}

/**
 * Serves the recording or file answering a task, from the homework's current
 * attempt. The teacher who owns the homework sees it; the student only in
 * their own published or submitted homework. A missing answer, a foreign
 * homework and no session all answer the same 404.
 */
export async function handleAnswerFileRequest(request: Request, homeworkId: string, taskIndex: string): Promise<Response> {
  if (!UUID.test(homeworkId) || !TASK_INDEX.test(taskIndex)) return notFound();
  const database = db();
  const owner = await requester(database, request.headers);
  if (!owner) return notFound();

  const [row] = await database
    .select({ document: homework.document, answer: homeworkAnswer.answer })
    .from(homework)
    .innerJoin(
      homeworkAnswer,
      and(
        eq(homeworkAnswer.homeworkId, homework.id),
        eq(homeworkAnswer.attempt, homework.attempt),
        eq(homeworkAnswer.taskIndex, Number(taskIndex)),
      ),
    )
    .where(
      and(
        eq(homework.id, homeworkId.toLowerCase()),
        eq(homework.teacherId, owner.teacherId),
        ...(owner.studentId
          ? [eq(homework.studentId, owner.studentId), inArray(homework.status, ["published", "submitted"])]
          : []),
      ),
    );
  const parsed = storedAnswerSchema.safeParse(row?.answer);
  const answer = parsed.success && (parsed.data.type === "voice" || parsed.data.type === "file") ? parsed.data : null;
  const task = (row?.document as HomeworkDocument | undefined)?.tasks[Number(taskIndex)];
  const file = answer && task?.type === answer.type ? await readBlob(database, owner.teacherId, answer.file) : null;
  if (!file || !answer) return notFound();

  // A new recording or file replaces the old one at the same address. The
  // browser keeps a copy but asks every time; the ETag is the stored file's
  // id, so an unchanged one costs a 304 (as homework pictures, #70).
  const caching = { ETag: `"${answer.file}"`, "Cache-Control": "private, no-cache" };
  if (request.headers.get("If-None-Match") === caching.ETag) return new Response(null, { status: 304, headers: caching });
  const headers = {
    ...caching,
    "Content-Type": file.contentType,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
  };
  // Safari plays audio only from a server that answers byte ranges.
  const size = file.bytes.byteLength;
  const range = byteRange(request.headers.get("Range"), size);
  if (range === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  }
  if (range) {
    return new Response(Buffer.from(file.bytes.subarray(range.start, range.end + 1)), {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        "Content-Length": String(range.end - range.start + 1),
      },
    });
  }
  return new Response(Buffer.from(file.bytes), { headers: { ...headers, "Content-Length": String(size) } });
}
