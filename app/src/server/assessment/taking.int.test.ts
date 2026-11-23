import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LINK_SESSION_COOKIES } from "../access/links";
import { closeDb, db } from "../db/client";
import { assessment, lesson, vocabularyWord } from "../db/schema";
import { env } from "../env";
import { appRouter, createServerCaller, handleAssessmentFileRequest, handleAssessmentFileUpload, handleRouterRequest } from "../router/index";
import { webmRecording } from "../testing/media";
import { seedTeachers, signedInHeaders } from "../testing/requests";
import { findAssessment } from "./assessments";
import { finishAssessment, openAssessmentToStudent, saveAnswer, studentAssessment, studentAssessments, submitAssessment } from "./taking";

// The monthly assessment taken in a lesson (#253): opened only while a
// lesson with the student is going on and closed at its end with the answers
// kept, continued in a later lesson; «Аудирование» played at most twice;
// «Сдать» and «Завершить замер» scoring the auto-checked sections, a
// section not started unscored; a wrong «Лексика» answer due tomorrow; the
// speaking recording the teacher's; and nothing of the keys, the scores or
// the recording for the child. The texts and the files are synthetic.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacherHeaders: Headers;
let otherHeaders: Headers;
let teacher: ReturnType<typeof createServerCaller>;
let teacherId: string;

const MINUTE = 60_000;
const DAY = 86_400_000;
const READING = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}: the demo robot walks to the blue box and back.`).join(" ");
const KEYS = ["pebble", "crate"];

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

const document = (word?: string) => ({
  version: 1,
  title: "Lesson assessment",
  sections: [
    {
      skill: "listening",
      questions: [
        { question: "Where?", options: ["here", "there", "nowhere"], answer: 2 },
        { question: "When?", options: ["now", "later", "never"], answer: 0 },
      ],
    },
    { skill: "reading", text: READING, questions: [{ type: "true_false", statement: "The box is blue.", answer: "true" }] },
    { skill: "grammar", text: "Pim ___ home and ___ tea.", gaps: [{ options: ["go", "went"], answer: 1 }, { options: ["drink", "drank"], answer: 1 }] },
    {
      skill: "vocabulary",
      questions: [
        { type: "translation", translation: "камешек", answers: ["pebble"], ...(word ? { vocabularyWord: word } : {}) },
        { type: "sentence", text: "A ___ of stones.", answers: ["crate"] },
      ],
    },
    { skill: "writing", task: "Write a note (30–60 words)." },
    { skill: "speaking", questions: ["What can you see?"] },
  ],
});

const fileUrl = (id: string, which: string) => `${env().APP_URL}/api/files/assessments/${id}/${which}`;
const put = (id: string, which: string, headers: Headers, body: Uint8Array) =>
  handleAssessmentFileUpload(new Request(fileUrl(id, which), { method: "PUT", headers, body: Buffer.from(body) }), id, which);
const get = (id: string, which: string, headers: Headers) => handleAssessmentFileRequest(new Request(fileUrl(id, which), { headers }), id, which);

async function childOf(studentId: string) {
  const link = (await teacher.teacher.links.student({ studentId })).url;
  const response = await handleRouterRequest(
    new Request(`${env().APP_URL}/api/trpc/links.exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: link.split("#")[1]! }) }),
  );
  const headers = new Headers({ cookie: response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES.student}=`))!.split(";")[0]! });
  return { headers, caller: createServerCaller(headers) };
}

async function lessonAt(studentId: string, startsAt: Date, minutes = 60, status = "scheduled") {
  const [row] = await db().insert(lesson).values({ teacherId, studentId, startsAt, durationMinutes: minutes, status }).returning({ id: lesson.id });
  return row!.id;
}

/** A student with an approved assessment, its recording uploaded, and a lesson going on now. */
async function approved(firstName: string, options: { word?: boolean } = {}) {
  const { id: studentId } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  let wordId: string | undefined;
  if (options.word) {
    await teacher.teacher.students.addWord({ studentId, word: "pebble", translation: "камешек", example: "" });
    wordId = (await teacher.teacher.students.vocabulary({ studentId }))[0]!.id;
  }
  const { id } = await teacher.teacher.assessments.import({ studentId, json: JSON.stringify(document(wordId)) });
  expect((await put(id, "listening", teacherHeaders, silence(800))).status).toBe(200);
  await teacher.teacher.assessments.approve({ assessmentId: id, revision: (await findAssessment(db(), teacherId, id))!.revision });
  await lessonAt(studentId, new Date(Date.now() - 5 * MINUTE));
  return { studentId, id, wordId };
}

const scores = async (id: string) => (await db().select({ scores: assessment.scores }).from(assessment).where(eq(assessment.id, id)))[0]!.scores;

beforeAll(async () => {
  teacherHeaders = await signedInHeaders(teacherA);
  otherHeaders = await signedInHeaders(teacherB);
  teacher = createServerCaller(teacherHeaders);
  teacherId = (await teacher.teacher.session.me()).id;
});

afterAll(closeDb);

describe("opening an assessment in a lesson", () => {
  it("needs an approved assessment and a lesson with the student going on now", async () => {
    const { id: studentId } = await teacher.teacher.students.create({ firstName: "Без урока", lastName: "", level: "A2", timeZone: "Europe/Moscow" });
    const { id: draft } = await teacher.teacher.assessments.import({ studentId, json: JSON.stringify({ ...document(), sections: document().sections.slice(1) }) });
    expect(await openAssessmentToStudent(db(), teacherId, draft)).toBe("not_approved");
    await teacher.teacher.assessments.approve({ assessmentId: draft, revision: (await findAssessment(db(), teacherId, draft))!.revision });
    expect(await openAssessmentToStudent(db(), teacherId, draft)).toBe("no_lesson");
    // A cancelled or a missed lesson is not going on; a lesson tomorrow is not either.
    await lessonAt(studentId, new Date(Date.now() - 5 * MINUTE), 60, "cancelled");
    await lessonAt(studentId, new Date(Date.now() + DAY));
    expect(await openAssessmentToStudent(db(), teacherId, draft)).toBe("no_lesson");
    // Another teacher's: not found.
    const other = createServerCaller(otherHeaders);
    await expect(other.teacher.assessments.open({ assessmentId: draft })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("closes at the lesson's end with the answers kept, and a later lesson goes on from them", async () => {
    const { studentId, id } = await approved("Два урока");
    const opened = await openAssessmentToStudent(db(), teacherId, id);
    expect(opened).toMatchObject({ until: expect.any(Date) });
    const until = (opened as { until: Date }).until;
    expect(Math.round((until.getTime() - Date.now()) / MINUTE)).toBe(55);

    expect(await saveAnswer(db(), teacherId, studentId, id, "listening", 0, "2")).toBe("ok");
    // After the lesson: closed to the child, nothing written, the answer kept.
    const after = new Date(until.getTime() + MINUTE);
    expect(await studentAssessments(db(), teacherId, studentId, after)).toEqual([]);
    expect(await studentAssessment(db(), teacherId, studentId, id, after)).toBeNull();
    expect(await saveAnswer(db(), teacherId, studentId, id, "listening", 1, "0", after)).toBe("not_found");
    expect(await submitAssessment(db(), teacherId, studentId, id, after)).toBe(false);

    // The next lesson: opened again, the child continues where they stopped.
    const next = new Date(Date.now() + 7 * DAY);
    await lessonAt(studentId, new Date(next.getTime() - 10 * MINUTE));
    expect(await openAssessmentToStudent(db(), teacherId, id, next)).toMatchObject({ until: expect.any(Date) });
    const resumed = await studentAssessment(db(), teacherId, studentId, id, next);
    expect(resumed!.answers).toEqual({ listening: ["2"] });
    expect(await saveAnswer(db(), teacherId, studentId, id, "listening", 1, "0", next)).toBe("ok");
    expect((await studentAssessment(db(), teacherId, studentId, id, next))!.answers).toEqual({ listening: ["2", "0"] });
  });
});

describe("the child taking it", () => {
  it("keeps two answers sent at once, refuses an answer that does not exist, and plays the recording twice only", async () => {
    const { studentId, id } = await approved("Отвечает быстро");
    await teacher.teacher.assessments.open({ assessmentId: id });
    const { caller: child, headers } = await childOf(studentId);

    await Promise.all([
      child.student.assessments.answer({ id, section: "grammar", index: 0, value: "1" }),
      child.student.assessments.answer({ id, section: "grammar", index: 1, value: "0" }),
      child.student.assessments.answer({ id, section: "vocabulary", index: 0, value: "Pebble " }),
    ]);
    expect((await child.student.assessments.get({ id })).answers).toMatchObject({ grammar: ["1", "0"], vocabulary: ["Pebble "] });
    for (const wrong of [
      { section: "grammar" as const, index: 0, value: "5" },
      { section: "grammar" as const, index: 2, value: "0" },
      { section: "reading" as const, index: 0, value: "maybe" },
      { section: "speaking" as const, index: 0, value: "hello" },
    ]) {
      await expect(child.student.assessments.answer({ id, ...wrong })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }

    // The recording: served while open; two plays counted, then no more.
    expect((await get(id, "listening", headers)).status).toBe(200);
    expect(await child.student.assessments.play({ id })).toEqual({ playsLeft: 1 });
    expect(await child.student.assessments.play({ id })).toEqual({ playsLeft: 0 });
    await expect(child.student.assessments.play({ id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await child.student.assessments.get({ id })).listening).toEqual({ playsLeft: 0, url: null });
  });

  it("is scored on «Сдать»: an unanswered question wrong, a section not started unscored, nothing more to change", async () => {
    const { studentId, id } = await approved("Сдаёт замер");
    await teacher.teacher.assessments.open({ assessmentId: id });
    const { caller: child } = await childOf(studentId);
    await child.student.assessments.answer({ id, section: "listening", index: 0, value: "2" });
    await child.student.assessments.answer({ id, section: "grammar", index: 0, value: "1" });
    await child.student.assessments.answer({ id, section: "grammar", index: 1, value: "0" });
    await child.student.assessments.answer({ id, section: "vocabulary", index: 0, value: " PEBBLE" });
    await child.student.assessments.answer({ id, section: "writing", index: 0, value: "A note to Pim." });
    await child.student.assessments.submit({ id });

    // «Чтение» was not started: no score. «Аудирование»: one of two, the second unanswered.
    expect(await scores(id)).toEqual({ listening: { right: 1, total: 2 }, grammar: { right: 1, total: 2 }, vocabulary: { right: 1, total: 2 } });
    const after = await child.student.assessments.get({ id });
    expect(after.submitted).toBe(true);
    await expect(child.student.assessments.answer({ id, section: "reading", index: 0, value: "true" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(child.student.assessments.submit({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await teacher.teacher.assessments.list({ studentId })).find((a) => a.id === id)!.taking).toBe("submitted");
  });

  it("brings a missed «Лексика» word back into the training, due tomorrow", async () => {
    const { studentId, id, wordId } = await approved("Ошибка в слове", { word: true });
    await db().update(vocabularyWord).set({ trainStep: 3, dueOn: "2099-01-01", wrongCount: 0 }).where(eq(vocabularyWord.id, wordId!));
    await teacher.teacher.assessments.open({ assessmentId: id });
    const { caller: child } = await childOf(studentId);
    await child.student.assessments.answer({ id, section: "vocabulary", index: 0, value: "stone" });
    await child.student.assessments.submit({ id });

    const [word] = await db()
      .select({ step: vocabularyWord.trainStep, dueOn: vocabularyWord.dueOn, wrong: vocabularyWord.wrongCount })
      .from(vocabularyWord)
      .where(and(eq(vocabularyWord.id, wordId!)));
    const tomorrow = new Date(Date.now() + DAY).toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" });
    expect(word).toEqual({ step: 0, dueOn: tomorrow, wrong: 1 });
  });
});

describe("«Завершить замер»", () => {
  it("counts unanswered as wrong, leaves a section not started unscored, and closes it to the child", async () => {
    const { studentId, id } = await approved("Завершает учитель");
    await teacher.teacher.assessments.open({ assessmentId: id });
    const { caller: child } = await childOf(studentId);
    await child.student.assessments.answer({ id, section: "reading", index: 0, value: "true" });
    await child.student.assessments.answer({ id, section: "listening", index: 1, value: "1" });

    await teacher.teacher.assessments.finish({ assessmentId: id });
    expect(await scores(id)).toEqual({ listening: { right: 0, total: 2 }, reading: { right: 1, total: 1 } });
    await expect(child.student.assessments.get({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await child.student.assessments.list()).toEqual([]);
    expect(await finishAssessment(db(), teacherId, id)).toBe("ended");
    await expect(teacher.teacher.assessments.open({ assessmentId: id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await teacher.teacher.assessments.list({ studentId })).find((a) => a.id === id)!.taking).toBe("finished");
  });
});

describe("the speaking recording", () => {
  it("is made by the teacher, at most 5 minutes, while the assessment is not ended, and served to her alone", async () => {
    const { studentId, id } = await approved("Говорит в звонке");
    await teacher.teacher.assessments.open({ assessmentId: id });
    const { headers: childHeaders } = await childOf(studentId);

    expect((await put(id, "speaking", teacherHeaders, webmRecording(3))).status).toBe(200);
    expect((await put(id, "speaking", teacherHeaders, webmRecording(5 * 60 + 5))).status).toBe(413);
    expect((await put(id, "speaking", teacherHeaders, silence(800))).status).toBe(415);
    expect((await put(id, "speaking", childHeaders, webmRecording(3))).status).toBe(404);
    expect((await put(id, "speaking", otherHeaders, webmRecording(3))).status).toBe(404);

    expect((await get(id, "speaking", teacherHeaders)).status).toBe(200);
    expect((await get(id, "speaking", childHeaders)).status).toBe(404);
    expect((await teacher.teacher.assessments.list({ studentId })).find((a) => a.id === id)!.speakingRecording).toMatch(/\/speaking$/);

    await teacher.teacher.assessments.finish({ assessmentId: id });
    expect((await put(id, "speaking", teacherHeaders, webmRecording(3))).status).toBe(404);
  });
});

describe("the child and the parent", () => {
  it("never get the keys, the scores or the speaking recording, and nothing of an assessment not opened", async () => {
    const { studentId, id } = await approved("Ничего лишнего");
    const { caller: child } = await childOf(studentId);
    // Not opened yet: nothing.
    expect(await child.student.assessments.list()).toEqual([]);
    await expect(child.student.assessments.get({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });

    await teacher.teacher.assessments.open({ assessmentId: id });
    await put(id, "speaking", teacherHeaders, webmRecording(2));
    await child.student.assessments.answer({ id, section: "vocabulary", index: 1, value: "box" });
    const seen = JSON.stringify([await child.student.assessments.list(), await child.student.assessments.get({ id })]);
    for (const key of [...KEYS, '"answer"', "scores", "speaking_recording", "/speaking", "right", "total"]) {
      expect(seen).not.toContain(key);
    }
    await child.student.assessments.submit({ id });
    const submitted = JSON.stringify(await child.student.assessments.get({ id }));
    for (const key of [...KEYS, "scores", "right", "total", "/speaking"]) expect(submitted).not.toContain(key);

    // Of the child's and the parent's procedures, only the child's assessments ones name an assessment.
    const procedures = Object.keys(appRouter._def.procedures).filter((p) => /^(student|parent)\./.test(p) && /assess/i.test(p));
    expect(procedures.sort()).toEqual(["student.assessments.answer", "student.assessments.get", "student.assessments.list", "student.assessments.play", "student.assessments.submit"]);
  });
});
