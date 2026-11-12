// Pictures in homework tasks (#33). A picture arrives as a data URL inside the
// homework JSON, is checked and kept in the blob store, and the stored
// document refers to it as "blob:<id>". It is served only after a permission
// check: the teacher who owns the homework, or the student whose published
// homework it is (architecture 8.1). Everything else is the same 404.
import { and, eq } from "drizzle-orm";
import {
  type HomeworkDocument,
  type ImageType,
  imageDataUrl,
  imageRef,
  type Task,
} from "../../domain/homework-format";
import { teacherIdFromHeaders } from "../access/auth";
import { linkSessionFromHeaders } from "../access/links";
import { readBlob, saveBlob } from "../blob/store";
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

export type StoreResult = { ok: true; homework: HomeworkDocument } | { ok: false; errors: string[] };

/**
 * Keeps the new pictures of a validated homework and replaces them with
 * references. A reference may stay only if `keep` has it: the pictures
 * already in this draft. Nothing is stored unless every picture is fine.
 */
export async function storeImages(
  database: Database,
  teacherId: string,
  document: HomeworkDocument,
  keep: ReadonlySet<string>,
): Promise<StoreResult> {
  const errors: string[] = [];
  const decoded = new Map<number, { type: ImageType; bytes: Uint8Array }>();
  for (const [index, task] of document.tasks.entries()) {
    if (!task.image) continue;
    const ref = imageRef(task.image);
    if (ref !== null) {
      if (!keep.has(ref)) errors.push(`Задание ${index + 1}, поле image: вставьте картинку как data:image/…;base64,…`);
      continue;
    }
    const data = imageDataUrl(task.image);
    const bytes = data ? new Uint8Array(Buffer.from(data.base64, "base64")) : null;
    if (!data || !bytes || !looksLike(data.type, bytes)) {
      errors.push(`Задание ${index + 1}, поле image: это не картинка ${data?.type.slice(6).toUpperCase() ?? ""}`.trim());
      continue;
    }
    decoded.set(index, { type: data.type, bytes });
  }
  if (errors.length > 0) return { ok: false, errors };

  const tasks: Task[] = [];
  for (const [index, task] of document.tasks.entries()) {
    const picture = decoded.get(index);
    tasks.push(
      picture ? { ...task, image: `blob:${await saveBlob(database, teacherId, picture.bytes, picture.type)}` } : task,
    );
  }
  return { ok: true, homework: { ...document, tasks } };
}

/** The references to stored pictures in a homework. */
export function imageRefs(document: HomeworkDocument): Set<string> {
  return new Set(document.tasks.flatMap((task) => (task.image && imageRef(task.image) ? [imageRef(task.image)!] : [])));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/**
 * Serves a task's picture. The teacher who owns the homework sees it in any
 * status; a student only in their own published homework. A missing task, a
 * foreign homework, a draft and no session all answer the same 404.
 */
export async function handleHomeworkImageRequest(request: Request, homeworkId: string, taskIndex: string): Promise<Response> {
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
  const image = (row?.document as HomeworkDocument | undefined)?.tasks[Number(taskIndex)]?.image;
  const ref = image ? imageRef(image) : null;
  const file = ref ? await readBlob(database, owner.teacherId, ref) : null;
  if (!file || !ref) return notFound();

  // The address names a task's position, not a file: reordering or replacing
  // puts another file there. The browser keeps a copy but asks every time;
  // the ETag is the file's id, so an unchanged picture costs a 304.
  const caching = { ETag: `"${ref}"`, "Cache-Control": "private, no-cache" };
  if (request.headers.get("If-None-Match") === caching.ETag) return new Response(null, { status: 304, headers: caching });
  return new Response(Buffer.from(file.bytes), {
    headers: {
      ...caching,
      "Content-Type": file.contentType,
      "Content-Length": String(file.bytes.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
