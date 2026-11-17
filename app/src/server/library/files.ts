// Serving a library material's file (#115): a game is served to its teacher,
// and to a student it is open to (#118), as a page that runs sandboxed —
// scripts allowed, but in an origin of its own, so it cannot reach the
// platform's pages, cookies or storage, whether it is framed or opened by its
// address. A missing material, another teacher's, a game not open to this
// student and no session all answer the same 404.
import { GAME_SANDBOX } from "../../domain/library";
import { teacherIdFromHeaders } from "../access/auth";
import { linkSessionFromHeaders } from "../access/links";
import { type Database, db } from "../db/client";
import { materialFile } from "./library";
import { studentGame } from "./student-games";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const notFound = () =>
  new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

/** Whose library to read the file from: the teacher's own, or a student's teacher when the game is open to that student. */
async function reader(database: Database, headers: Headers, id: string): Promise<string | null> {
  const teacherId = await teacherIdFromHeaders(headers);
  if (teacherId) return teacherId;
  const session = await linkSessionFromHeaders(database, headers, "student");
  if (session?.role !== "student") return null;
  return (await studentGame(database, session.teacherId, session.studentId, id)) ? session.teacherId : null;
}

export async function handleLibraryFileRequest(request: Request, id: string): Promise<Response> {
  if (!UUID.test(id)) return notFound();
  const database = db();
  const teacherId = await reader(database, request.headers, id.toLowerCase());
  if (!teacherId) return notFound();
  const file = await materialFile(database, teacherId, id.toLowerCase());
  if (!file) return notFound();

  const caching = { ETag: `"${file.blobId}"`, "Cache-Control": "private, no-cache" };
  if (request.headers.get("If-None-Match") === caching.ETag) return new Response(null, { status: 304, headers: caching });
  return new Response(Buffer.from(file.bytes), {
    headers: {
      ...caching,
      "Content-Type": file.contentType,
      "Content-Length": String(file.bytes.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      // The sandbox holds when the address is opened directly, not only in the frame.
      "Content-Security-Policy": `sandbox ${GAME_SANDBOX}`,
      "Referrer-Policy": "no-referrer",
    },
  });
}
