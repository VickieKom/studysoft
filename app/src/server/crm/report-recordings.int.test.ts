import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_RECORDING_BYTES } from "../../domain/report";
import { LINK_SESSION_COOKIES } from "../access/links";
import { eq } from "drizzle-orm";
import { removeUnreferencedBlobs } from "../blob/store";
import { closeDb, db } from "../db/client";
import { blob } from "../db/schema";
import { env } from "../env";
import { createServerCaller, handleReportRecordingRemove, handleReportRecordingRequest, handleReportRecordingUpload, handleRouterRequest } from "../router/index";
import { seedTeachers, signedInHeaders } from "../testing/requests";

// The recordings «было» and «стало» of a parent's report (#269): uploaded by
// the report's teacher only, MP3, M4A, WAV or OGG up to 20 MB; served to her,
// and to the student's parent once the report is published; everyone else
// gets the same 404. The recordings are generated silence.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacherHeaders: Headers;
let otherHeaders: Headers;
let teacher: ReturnType<typeof createServerCaller>;

function silence(samples: number): Uint8Array {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(8000, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples, 40);
  return new Uint8Array(Buffer.concat([header, Buffer.alloc(samples, 0x80)]));
}

const url = (reportId: string, which: string) => `${env().APP_URL}/api/files/reports/${reportId}/${which}`;
const put = (reportId: string, which: string, headers: Headers, body: Uint8Array) =>
  handleReportRecordingUpload(new Request(url(reportId, which), { method: "PUT", headers, body: Buffer.from(body) }), reportId, which);
const get = (reportId: string, which: string, headers: Headers = new Headers()) =>
  handleReportRecordingRequest(new Request(url(reportId, which), { headers }), reportId, which);

async function linkHeaders(studentId: string, role: "student" | "parent") {
  const link = role === "student" ? (await teacher.teacher.links.student({ studentId })).url : (await teacher.teacher.links.parent({ studentId })).url;
  const response = await handleRouterRequest(
    new Request(`${env().APP_URL}/api/trpc/links.exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: link.split("#")[1]! }) }),
  );
  return new Headers({ cookie: response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES[role]}=`))!.split(";")[0]! });
}

async function draftOf(firstName: string) {
  const { id: studentId } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  return { studentId, reportId: (await teacher.teacher.reports.open({ studentId })).id };
}

beforeAll(async () => {
  teacherHeaders = await signedInHeaders(teacherA);
  otherHeaders = await signedInHeaders(teacherB);
  teacher = createServerCaller(teacherHeaders);
});

afterAll(closeDb);

describe("a report's recordings", () => {
  it("are uploaded by the report's teacher and served to the parent once published, to no one else", async () => {
    const { studentId, reportId } = await draftOf("Записи отчёта");
    const parent = await linkHeaders(studentId, "parent");
    const student = await linkHeaders(studentId, "student");
    const { studentId: otherChild } = await draftOf("Записи чужого");
    const otherParent = await linkHeaders(otherChild, "parent");

    expect((await put(reportId, "before", otherHeaders, silence(800))).status).toBe(404);
    expect((await put(reportId, "before", parent, silence(800))).status).toBe(404);
    const uploaded = await put(reportId, "before", teacherHeaders, silence(800));
    expect(uploaded.status).toBe(200);
    expect(await uploaded.json()).toEqual({ url: `/api/files/reports/${reportId}/before` });
    expect((await teacher.teacher.reports.get({ reportId })).recordings).toEqual({ before: `/api/files/reports/${reportId}/before`, after: null });

    const mine = await get(reportId, "before", teacherHeaders);
    expect(mine.status).toBe(200);
    expect(mine.headers.get("Content-Type")).toBe("audio/wav");
    expect((await mine.arrayBuffer()).byteLength).toBe(844);
    // A draft's recording is not the parent's yet.
    expect((await get(reportId, "before", parent)).status).toBe(404);

    await teacher.teacher.reports.publish({ reportId });
    expect((await get(reportId, "before", parent)).status).toBe(200);
    const partial = await handleReportRecordingRequest(new Request(url(reportId, "before"), { headers: { cookie: parent.get("cookie")!, Range: "bytes=0-43" } }), reportId, "before");
    expect(partial.status).toBe(206);
    expect((await partial.arrayBuffer()).byteLength).toBe(44);
    for (const headers of [otherParent, student, otherHeaders, new Headers()]) expect((await get(reportId, "before", headers)).status).toBe(404);
    // Not uploaded, an unknown recording, a malformed address: the same 404.
    expect((await get(reportId, "after", parent)).status).toBe(404);
    expect((await get(reportId, "middle", teacherHeaders)).status).toBe(404);
    expect((await get("not-a-uuid", "before", teacherHeaders)).status).toBe(404);

    const [shown] = await createServerCaller(parent).parent.reports();
    expect(shown!.recordings).toEqual({ before: `/api/files/reports/${reportId}/before`, after: null });
  });

  it("refuses a file that is not MP3, M4A, WAV or OGG, and one over 20 MB; a recording is replaced and removed", async () => {
    const { reportId } = await draftOf("Записи проверка");
    const text = await put(reportId, "after", teacherHeaders, new TextEncoder().encode("не запись, а текст"));
    expect(text.status).toBe(415);
    expect(await text.json()).toEqual({ error: "Можно загрузить аудио: MP3, M4A, WAV или OGG" });
    const big = await put(reportId, "after", teacherHeaders, silence(MAX_RECORDING_BYTES));
    expect(big.status).toBe(413);
    expect((await get(reportId, "after", teacherHeaders)).status).toBe(404);

    await put(reportId, "after", teacherHeaders, silence(800));
    await put(reportId, "after", teacherHeaders, silence(1600));
    expect((await (await get(reportId, "after", teacherHeaders)).arrayBuffer()).byteLength).toBe(1644);
    // The nightly cleanup keeps the recording a report refers to, even an old one.
    await db().update(blob).set({ createdAt: new Date(Date.now() - 48 * 3_600_000) }).where(eq(blob.size, 1644));
    await removeUnreferencedBlobs(db());
    expect((await get(reportId, "after", teacherHeaders)).status).toBe(200);
    const remove = (headers: Headers) => handleReportRecordingRemove(new Request(url(reportId, "after"), { method: "DELETE", headers }), reportId, "after");
    expect((await remove(otherHeaders)).status).toBe(404);
    expect((await remove(teacherHeaders)).status).toBe(204);
    expect((await get(reportId, "after", teacherHeaders)).status).toBe(404);
    // Removed, the old recording is nobody's: the cleanup takes it.
    expect(await removeUnreferencedBlobs(db())).toMatchObject({ removed: 1, bytes: 1644 });
  });
});
