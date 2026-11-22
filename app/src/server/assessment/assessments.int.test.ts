import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LINK_SESSION_COOKIES } from "../access/links";
import { removeUnreferencedBlobs } from "../blob/store";
import { closeDb, db } from "../db/client";
import { assessment, blob } from "../db/schema";
import { env } from "../env";
import {
  appRouter,
  createServerCaller,
  handleAssessmentFileRemove,
  handleAssessmentFileRequest,
  handleAssessmentFileUpload,
  handleRouterRequest,
} from "../router/index";
import { seedTeachers, signedInHeaders } from "../testing/requests";
import { approveAssessment, findAssessment, removeQuestionFrom } from "./assessments";

// The monthly assessment on the card (#252): imported in the assessment
// format, shown without keys, a question removed, the recording for
// «Аудирование» and the picture for «Говорение» uploaded by the teacher
// only, approved and then fixed. No student or parent procedure returns an
// assessment or its keys. The texts and the files are synthetic.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacherHeaders: Headers;
let otherHeaders: Headers;
let teacher: ReturnType<typeof createServerCaller>;
let other: ReturnType<typeof createServerCaller>;
let teacherId: string;

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

/** The smallest PNG signature and header the type is told by. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);

const url = (id: string, which: string) => `${env().APP_URL}/api/files/assessments/${id}/${which}`;
const put = (id: string, which: string, headers: Headers, body: Uint8Array) =>
  handleAssessmentFileUpload(new Request(url(id, which), { method: "PUT", headers, body: Buffer.from(body) }), id, which);
const get = (id: string, which: string, headers: Headers = new Headers()) => handleAssessmentFileRequest(new Request(url(id, which), { headers }), id, which);
const remove = (id: string, which: string, headers: Headers) => handleAssessmentFileRemove(new Request(url(id, which), { method: "DELETE", headers }), id, which);

const READING = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}: the demo robot walks to the blue box and back.`).join(" ");
const KEYS = ["pebble", "crate"];

const document = (vocabularyWord?: string) => ({
  version: 1,
  title: "Demo assessment",
  sections: [
    { skill: "listening", questions: [{ question: "Where?", options: ["here", "there", "nowhere"], answer: 2 }] },
    { skill: "reading", text: READING, questions: [{ type: "true_false", statement: "The box is blue.", answer: "not_given" }] },
    { skill: "grammar", text: "Pim ___ home.", gaps: [{ options: ["go", "went"], answer: 1 }] },
    {
      skill: "vocabulary",
      questions: [
        { type: "translation", translation: "камешек", answers: ["pebble"], ...(vocabularyWord ? { vocabularyWord } : {}) },
        { type: "sentence", text: "A ___ of stones.", answers: ["crate"] },
      ],
    },
    { skill: "writing", task: "Write a note (30–60 words)." },
    { skill: "speaking", questions: ["What can you see?", "What is the robot doing?"] },
  ],
});

async function newStudent(firstName: string) {
  const { id } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  return id;
}

async function imported(firstName: string, json: unknown = document()) {
  const studentId = await newStudent(firstName);
  const { id } = await teacher.teacher.assessments.import({ studentId, json: JSON.stringify(json) });
  return { studentId, id };
}

async function linkCaller(studentId: string, role: "student" | "parent") {
  const link = role === "student" ? (await teacher.teacher.links.student({ studentId })).url : (await teacher.teacher.links.parent({ studentId })).url;
  const response = await handleRouterRequest(
    new Request(`${env().APP_URL}/api/trpc/links.exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: link.split("#")[1]! }) }),
  );
  const headers = new Headers({ cookie: response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES[role]}=`))!.split(";")[0]! });
  return { headers, caller: createServerCaller(headers) };
}

const listed = async (studentId: string, id: string) => (await teacher.teacher.assessments.list({ studentId })).find((a) => a.id === id)!;

beforeAll(async () => {
  teacherHeaders = await signedInHeaders(teacherA);
  otherHeaders = await signedInHeaders(teacherB);
  teacher = createServerCaller(teacherHeaders);
  other = createServerCaller(otherHeaders);
  teacherId = (await teacher.teacher.session.me()).id;
});

afterAll(closeDb);

describe("an assessment on the card", () => {
  it("is imported as a draft and listed by section, in the format's order, without keys", async () => {
    const json = document();
    json.sections.reverse();
    const { studentId, id } = await imported("Замер по разделам", json);
    const shown = await listed(studentId, id);
    expect(shown).toMatchObject({ title: "Demo assessment", status: "draft", recording: null, picture: null });
    expect(shown.sections.map((s) => s.skill)).toEqual(["listening", "reading", "grammar", "vocabulary", "writing", "speaking"]);
    const text = JSON.stringify(shown);
    for (const key of [...KEYS, "not_given", '"answer"']) expect(text).not.toContain(key);
    // The keys are kept for checking (#253).
    const [row] = await db().select({ document: assessment.document }).from(assessment).where(eq(assessment.id, id));
    expect(JSON.stringify(row!.document)).toContain("pebble");
  });

  it("refuses a draft that fails the format with readable errors, and saves nothing", async () => {
    const studentId = await newStudent("Замер с ошибкой");
    const broken = document();
    (broken.sections[3] as { questions: { answers: string[] }[] }).questions[1]!.answers = [];
    await expect(teacher.teacher.assessments.import({ studentId, json: JSON.stringify(broken) })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/^Лексика, вопрос 2, поле answers: /),
    });
    await expect(teacher.teacher.assessments.import({ studentId, json: "{" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await teacher.teacher.assessments.list({ studentId })).toEqual([]);
  });

  it("keeps a vocabulary link to the student's own word only", async () => {
    const studentId = await newStudent("Замер со словом");
    const [own] = await teacher.teacher.students.addWord({ studentId, word: "pebble", translation: "камешек", example: "" }).then(async () =>
      (await teacher.teacher.students.vocabulary({ studentId })).map((w) => w.id),
    );
    const { id: withOwn } = await teacher.teacher.assessments.import({ studentId, json: JSON.stringify(document(own)) });
    const { id: withForeign } = await teacher.teacher.assessments.import({ studentId, json: JSON.stringify(document("00000000-0000-4000-8000-000000000000")) });
    const vocabularyOf = async (id: string) =>
      ((await findAssessment(db(), teacherId, id))!.document.sections.find((s) => s.skill === "vocabulary") as { questions: { vocabularyWord?: string }[] }).questions;
    expect((await vocabularyOf(withOwn))[0]).toMatchObject({ vocabularyWord: own });
    expect((await vocabularyOf(withForeign))[0]).not.toHaveProperty("vocabularyWord");
    expect(await vocabularyOf(withForeign)).toHaveLength(2);
  });

  it("is another teacher's to no one: her list, import, removal and approval find nothing", async () => {
    const { studentId, id } = await imported("Чужой замер");
    await expect(other.teacher.assessments.list({ studentId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.teacher.assessments.import({ studentId, json: JSON.stringify(document()) })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.teacher.assessments.removeQuestion({ assessmentId: id, section: "vocabulary", index: 0 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.teacher.assessments.approve({ assessmentId: id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listed(studentId, id)).status).toBe("draft");
  });

  it("loses a question to «Убрать», the section with its last one, never the grammar text or the last question", async () => {
    const { studentId, id } = await imported("Замер без вопроса");
    await teacher.teacher.assessments.removeQuestion({ assessmentId: id, section: "vocabulary", index: 0 });
    const vocabulary = (await listed(studentId, id)).sections.find((s) => s.skill === "vocabulary")!;
    expect(vocabulary.questions).toEqual([{ type: "sentence", text: "A ___ of stones." }]);
    await teacher.teacher.assessments.removeQuestion({ assessmentId: id, section: "listening", index: 0 });
    expect((await listed(studentId, id)).sections.map((s) => s.skill)).not.toContain("listening");
    await expect(teacher.teacher.assessments.removeQuestion({ assessmentId: id, section: "grammar", index: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(teacher.teacher.assessments.removeQuestion({ assessmentId: id, section: "speaking", index: 5 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("does not undo an approval or another removal that came between the removal's read and its write", async () => {
    const { studentId, id } = await imported("Гонка за вопрос");
    // The removal has read the draft...
    const read = (await findAssessment(db(), teacherId, id))!;
    // ...another removal lands first...
    await teacher.teacher.assessments.removeQuestion({ assessmentId: id, section: "speaking", index: 0 });
    // ...and the stale one must not write its document over it.
    expect(await removeQuestionFrom(db(), teacherId, read, "vocabulary", 0)).toBe("changed");
    const after = await listed(studentId, id);
    expect(after.sections.find((s) => s.skill === "speaking")!.questions).toHaveLength(1);
    expect(after.sections.find((s) => s.skill === "vocabulary")!.questions).toHaveLength(2);

    // The same with an approval in between: the approved assessment stays as approved.
    const { studentId: second, id: secondId } = await imported("Гонка с утверждением", { ...document(), sections: document().sections.slice(1) });
    const before = (await findAssessment(db(), teacherId, secondId))!;
    expect(await approveAssessment(db(), teacherId, secondId)).toBe("ok");
    expect(await removeQuestionFrom(db(), teacherId, before, "vocabulary", 0)).toBe("changed");
    expect((await listed(second, secondId)).sections.find((s) => s.skill === "vocabulary")!.questions).toHaveLength(2);
  });
});

describe("approving an assessment", () => {
  it("wants the recording when it has «Аудирование», then fixes it: no removal, no upload, no new file", async () => {
    const { studentId, id } = await imported("Замер к утверждению");
    await expect(teacher.teacher.assessments.approve({ assessmentId: id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("Нет записи для аудирования"),
    });
    expect((await listed(studentId, id)).status).toBe("draft");

    expect((await put(id, "listening", teacherHeaders, silence(800))).status).toBe(200);
    await teacher.teacher.assessments.approve({ assessmentId: id });
    expect(await listed(studentId, id)).toMatchObject({ status: "approved", recording: `/api/files/assessments/${id}/listening` });

    await expect(teacher.teacher.assessments.removeQuestion({ assessmentId: id, section: "vocabulary", index: 0 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await put(id, "listening", teacherHeaders, silence(1600))).status).toBe(409);
    expect((await put(id, "picture", teacherHeaders, PNG)).status).toBe(409);
    expect((await remove(id, "listening", teacherHeaders)).status).toBe(404);
    expect((await get(id, "listening", teacherHeaders)).status).toBe(200);
    // Approving again changes nothing.
    await teacher.teacher.assessments.approve({ assessmentId: id });
  });

  it("needs no recording without «Аудирование» and no picture for «Говорение»", async () => {
    const { studentId, id } = await imported("Замер без аудирования", { ...document(), sections: document().sections.slice(1) });
    await teacher.teacher.assessments.approve({ assessmentId: id });
    expect(await listed(studentId, id)).toMatchObject({ status: "approved", picture: null });
  });
});

describe("an assessment's files", () => {
  it("are uploaded by its teacher only, of their own types, and served to her alone", async () => {
    const { studentId, id } = await imported("Замер с файлами");
    const student = await linkCaller(studentId, "student");
    const parent = await linkCaller(studentId, "parent");

    expect((await put(id, "listening", otherHeaders, silence(800))).status).toBe(404);
    expect((await put(id, "listening", student.headers, silence(800))).status).toBe(404);
    expect((await put(id, "listening", teacherHeaders, PNG)).status).toBe(415);
    expect((await put(id, "picture", teacherHeaders, silence(800))).status).toBe(415);
    expect((await put(id, "transcript", teacherHeaders, silence(800))).status).toBe(404);

    const uploaded = await put(id, "listening", teacherHeaders, silence(800));
    expect(await uploaded.json()).toEqual({ url: `/api/files/assessments/${id}/listening` });
    expect((await put(id, "picture", teacherHeaders, PNG)).status).toBe(200);
    expect(await listed(studentId, id)).toMatchObject({ recording: `/api/files/assessments/${id}/listening`, picture: `/api/files/assessments/${id}/picture` });

    const served = await get(id, "listening", teacherHeaders);
    expect(served.status).toBe(200);
    expect(served.headers.get("Content-Type")).toBe("audio/wav");
    expect((await get(id, "listening", new Headers({ ...Object.fromEntries(teacherHeaders), Range: "bytes=0-43" }))).status).toBe(206);
    const missing = await get("00000000-0000-4000-8000-000000000000", "listening", teacherHeaders);
    for (const headers of [otherHeaders, student.headers, parent.headers, new Headers()]) {
      const refused = await get(id, "listening", headers);
      expect({ status: refused.status, body: await refused.text() }).toEqual({ status: missing.status, body: "Not found" });
    }

    expect((await remove(id, "picture", otherHeaders)).status).toBe(404);
    expect((await remove(id, "picture", teacherHeaders)).status).toBe(204);
    expect((await listed(studentId, id)).picture).toBeNull();
  });

  it("are kept by the nightly cleanup while the assessment refers to them", async () => {
    const { id } = await imported("Замер и уборка");
    await put(id, "listening", teacherHeaders, silence(800));
    const [row] = await db().select({ file: assessment.listeningRecording }).from(assessment).where(eq(assessment.id, id));
    await removeUnreferencedBlobs(db(), new Date(Date.now() + 48 * 3_600_000));
    expect(await db().select({ id: blob.id }).from(blob).where(eq(blob.id, row!.file!))).toHaveLength(1);
  });
});

describe("students and parents", () => {
  it("have no procedure that returns an assessment, and theirs carry none of its keys", async () => {
    const procedures = Object.keys(appRouter._def.procedures).filter((p) => /^(student|parent)\./.test(p));
    expect(procedures.filter((p) => /assess/i.test(p))).toEqual([]);

    const { studentId, id } = await imported("Замер и ссылки");
    await put(id, "listening", teacherHeaders, silence(800));
    await teacher.teacher.assessments.approve({ assessmentId: id });
    const { caller: student } = await linkCaller(studentId, "student");
    const { caller: parent } = await linkCaller(studentId, "parent");
    const outputs = JSON.stringify([
      await student.student.me(),
      await student.student.homework.current(),
      await student.student.games.list(),
      await student.student.videos.list(),
      await student.student.vocabulary.words(),
      await parent.parent.me(),
      await parent.parent.progress(),
    ]);
    for (const key of [...KEYS, "Demo assessment", id]) expect(outputs).not.toContain(key);
  });
});
