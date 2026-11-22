import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateAssessment } from "../../../domain/assessment-format";
import { assessmentPeriod, findAssessment, MAX_ASSESSMENT_LENGTH, saveAssistantAssessment } from "../../assessment/assessments";
import { closeDb, db } from "../../db/client";
import { assessment, lesson, vocabularyWord } from "../../db/schema";
import { env } from "../../env";
import { pdf } from "../../testing/files";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleAssessmentFileUpload, handleTextbookUpload } from "../index";

// The assistant drafts the month's assessment (#313): the format, a draft
// «от ассистента» validated like an import, replaced while the teacher has
// done nothing to it, kept once she has; another teacher's student not found;
// and the period of the student context it drafts from. The texts are
// synthetic.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacherHeaders: Headers;
let teacher: ReturnType<typeof createServerCaller>;
let other: ReturnType<typeof createServerCaller>;
let assistant: ReturnType<typeof createServerCaller>;
let otherAssistant: ReturnType<typeof createServerCaller>;
let teacherId: string;

const DAY = 86_400_000;
const READING = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}: the demo robot walks to the blue box and back.`).join(" ");

const draft = (title: string, vocabularyWord?: string) => ({
  version: 1,
  title,
  sections: [
    { skill: "reading", text: READING, questions: [{ type: "true_false", statement: "The box is blue.", answer: "true" }] },
    {
      skill: "vocabulary",
      questions: [
        { type: "translation", translation: "камешек", answers: ["pebble"], ...(vocabularyWord ? { vocabularyWord } : {}) },
        { type: "sentence", text: "A ___ of stones.", answers: ["crate"] },
      ],
    },
    { skill: "speaking", questions: ["What can you see?", "What is the robot doing?"] },
  ],
});

/** The smallest PNG signature and header the type is told by. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);

async function newStudent(firstName: string) {
  const { id } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  return id;
}

const onCard = (studentId: string) => teacher.teacher.assessments.list({ studentId });
/** The revision the teacher's page has seen of an assessment, as `list` gives it. */
const seen = async (id: string) => (await findAssessment(db(), teacherId, id))!.revision;

beforeAll(async () => {
  teacherHeaders = await signedInHeaders(teacherA);
  teacher = createServerCaller(teacherHeaders);
  other = createServerCaller(await signedInHeaders(teacherB));
  assistant = createServerCaller(new Headers({ authorization: `Bearer ${(await teacher.teacher.assistant.createToken()).token}` }));
  otherAssistant = createServerCaller(new Headers({ authorization: `Bearer ${(await other.teacher.assistant.createToken()).token}` }));
  teacherId = (await teacher.teacher.session.me()).id;
});

afterAll(closeDb);

describe("the assistant's assessment draft", () => {
  it("reads the format with its version", async () => {
    const format = await assistant.agent.assessmentFormat();
    expect(format.version).toBe(1);
    expect(format.description).toMatch(/^# Assessment format, version 1/);
  });

  it("shows «от ассистента» without keys, with the period it was drafted from, and an import does not", async () => {
    const studentId = await newStudent("Черновик замера");
    const { id } = await assistant.agent.saveAssessmentDraft({ studentId, assessment: draft("Assistant draft") });
    await teacher.teacher.assessments.import({ studentId, json: JSON.stringify(draft("Teacher's own")) });

    const listed = await onCard(studentId);
    expect(listed.map((a) => [a.title, a.status, a.fromAssistant])).toEqual([
      ["Teacher's own", "draft", false],
      ["Assistant draft", "draft", true],
    ]);
    expect(JSON.stringify(listed)).not.toMatch(/pebble|crate/);
    const [row] = await db().select({ createdBy: assessment.createdBy, context: assessment.context }).from(assessment).where(eq(assessment.id, id));
    expect(row!.createdBy).toBe("agent");
    // Only the period: the rest of the student context stays where the teacher can delete it.
    expect(Object.keys(row!.context as object)).toEqual(["assessmentPeriod"]);
    expect(row!.context).toMatchObject({ assessmentPeriod: { lastAssessmentAt: null, coveredUnits: [], words: [] } });
  });

  it("is replaced while the teacher has done nothing to it", async () => {
    const studentId = await newStudent("Замена замера");
    const first = await assistant.agent.saveAssessmentDraft({ studentId, assessment: draft("First") });
    const second = await assistant.agent.saveAssessmentDraft({ studentId, assessment: draft("Second") });
    expect(second.id).toBe(first.id);
    expect((await onCard(studentId)).map((a) => a.title)).toEqual(["Second"]);
  });

  it("is kept once the teacher removes a question, uploads a picture or approves, and the next save makes a new one", async () => {
    // A removal.
    const removed = await newStudent("Убрала вопрос");
    const { id: hers } = await assistant.agent.saveAssessmentDraft({ studentId: removed, assessment: draft("Hers") });
    await teacher.teacher.assessments.removeQuestion({ assessmentId: hers, revision: await seen(hers), section: "vocabulary", index: 0 });
    const next = await assistant.agent.saveAssessmentDraft({ studentId: removed, assessment: draft("Next") });
    expect(next.id).not.toBe(hers);
    const kept = (await onCard(removed)).find((a) => a.id === hers)!;
    expect(kept.title).toBe("Hers");
    expect(kept.sections.find((s) => s.skill === "vocabulary")!.questions).toHaveLength(1);

    // The picture: it stays on her draft.
    const pictured = await newStudent("Загрузила картинку");
    const { id: withPicture } = await assistant.agent.saveAssessmentDraft({ studentId: pictured, assessment: draft("With a picture") });
    const url = `${env().APP_URL}/api/files/assessments/${withPicture}/picture`;
    const upload = await handleAssessmentFileUpload(new Request(url, { method: "PUT", headers: teacherHeaders, body: Buffer.from(PNG) }), withPicture, "picture");
    expect(upload.status).toBe(200);
    expect((await assistant.agent.saveAssessmentDraft({ studentId: pictured, assessment: draft("After the picture") })).id).not.toBe(withPicture);
    expect((await onCard(pictured)).find((a) => a.id === withPicture)).toMatchObject({ title: "With a picture", picture: expect.any(String) });

    // An approved assessment is never replaced.
    const approved = await newStudent("Утвердила");
    const { id: fixed } = await assistant.agent.saveAssessmentDraft({ studentId: approved, assessment: draft("Approved") });
    await teacher.teacher.assessments.approve({ assessmentId: fixed, revision: await seen(fixed) });
    expect((await assistant.agent.saveAssessmentDraft({ studentId: approved, assessment: draft("After approval") })).id).not.toBe(fixed);
    expect((await onCard(approved)).find((a) => a.id === fixed)).toMatchObject({ title: "Approved", status: "approved" });
  });

  it("waits for the teacher's action in progress and then makes a new draft instead of replacing hers", async () => {
    const studentId = await newStudent("Гонка с ассистентом");
    const { id: hers } = await assistant.agent.saveAssessmentDraft({ studentId, assessment: draft("Hers, being edited") });
    const context = { assessmentPeriod: await assessmentPeriod(db(), teacherId, studentId) };

    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    // The teacher's action: it has written her mark on the row and not committed yet.
    const action = db().transaction(async (tx) => {
      await tx.update(assessment).set({ teacherEditedAt: new Date() }).where(eq(assessment.id, hers));
      locked();
      await held;
    });
    await lockTaken;

    // The assistant's save found her draft untouched and now waits for the row.
    const checked = validateAssessment(draft("Assistant's save"));
    if (!checked.ok) throw new Error(checked.errors.join("\n"));
    let settled = false;
    const save = saveAssistantAssessment(db(), teacherId, studentId, checked.assessment, context).then((id) => {
      settled = true;
      return id;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(settled).toBe(false);

    release();
    await action;
    const saved = await save;
    expect(saved).not.toBe(hers);
    const listed = await onCard(studentId);
    expect(listed.find((a) => a.id === hers)!.title).toBe("Hers, being edited");
    expect(listed.find((a) => a.id === saved)!.title).toBe("Assistant's save");
  });

  it("is approved only as the version the teacher's page has seen: a save of the assistant's in between is refused «Замер изменился»", async () => {
    const studentId = await newStudent("Утвердить увиденное");
    const { id } = await assistant.agent.saveAssessmentDraft({ studentId, assessment: draft("Version one") });
    // The teacher's page has read version one...
    const shown = (await onCard(studentId)).find((a) => a.id === id)!;
    expect(shown.title).toBe("Version one");
    // ...the assistant replaces the untouched draft...
    expect((await assistant.agent.saveAssessmentDraft({ studentId, assessment: draft("Version two") })).id).toBe(id);
    // ...and «Утвердить» and «Убрать» from that page are refused, with nothing changed.
    await expect(teacher.teacher.assessments.approve({ assessmentId: id, revision: shown.revision })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Замер изменился. Обновите страницу",
    });
    await expect(
      teacher.teacher.assessments.removeQuestion({ assessmentId: id, revision: shown.revision, section: "vocabulary", index: 0 }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "Замер изменился. Обновите страницу" });
    const after = (await onCard(studentId)).find((a) => a.id === id)!;
    expect(after).toMatchObject({ title: "Version two", status: "draft" });
    expect(after.sections.find((s) => s.skill === "vocabulary")!.questions).toHaveLength(2);

    // The page refreshed: the version it now shows is approved.
    await teacher.teacher.assessments.approve({ assessmentId: id, revision: after.revision });
    expect((await onCard(studentId)).find((a) => a.id === id)).toMatchObject({ title: "Version two", status: "approved" });
  });

  it("is refused when it is longer than the teacher's import, and nothing is saved", async () => {
    const studentId = await newStudent("Длинный черновик");
    const long = draft("Long");
    (long.sections[0] as { text: string }).text = "x".repeat(MAX_ASSESSMENT_LENGTH);
    await expect(assistant.agent.saveAssessmentDraft({ studentId, assessment: long })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining(`longer than ${MAX_ASSESSMENT_LENGTH} characters`),
    });
    expect(await onCard(studentId)).toEqual([]);
  });

  it("is refused with the import's messages when it fails the format, and nothing is saved", async () => {
    const studentId = await newStudent("Неформатный черновик");
    const broken = draft("Broken");
    (broken.sections[1]!.questions![1] as { answers: string[] }).answers = [];
    await expect(assistant.agent.saveAssessmentDraft({ studentId, assessment: broken })).rejects.toThrow(/Лексика, вопрос 2, поле answers/);
    await expect(teacher.teacher.assessments.import({ studentId, json: JSON.stringify(broken) })).rejects.toThrow(/Лексика, вопрос 2, поле answers/);
    expect(await onCard(studentId)).toEqual([]);
  });

  it("keeps a vocabulary link to the student's own word only", async () => {
    const studentId = await newStudent("Слово замера");
    await teacher.teacher.students.addWord({ studentId, word: "pebble", translation: "камешек", example: "" });
    const own = (await assistant.agent.studentWords({ studentId }))[0]!.id;
    const { id } = await assistant.agent.saveAssessmentDraft({ studentId, assessment: draft("Linked", own) });
    const [row] = await db().select({ document: assessment.document }).from(assessment).where(eq(assessment.id, id));
    expect(JSON.stringify(row!.document)).toContain(own);

    const otherStudent = await newStudent("Чужое слово замера");
    const { id: dropped } = await assistant.agent.saveAssessmentDraft({ studentId: otherStudent, assessment: draft("Not linked", own) });
    const [unlinked] = await db().select({ document: assessment.document }).from(assessment).where(eq(assessment.id, dropped));
    expect(JSON.stringify(unlinked!.document)).not.toContain(own);
  });

  it("is not saved for another teacher's student, the same as a missing one", async () => {
    const studentId = await newStudent("Не для чужого ассистента");
    await expect(otherAssistant.agent.saveAssessmentDraft({ studentId, assessment: draft("Foreign") })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(otherAssistant.agent.saveAssessmentDraft({ studentId: crypto.randomUUID(), assessment: draft("Missing") })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await onCard(studentId)).toEqual([]);
  });
});

describe("the assessment period in the student context", () => {
  let textbookId: string;
  let bookLessons: Record<string, string>;

  beforeAll(async () => {
    const response = await handleTextbookUpload(
      new Request(`${env().APP_URL}/api/files/textbooks?kind=book`, { method: "PUT", headers: teacherHeaders, body: new Uint8Array(pdf(6)) }),
    );
    const file = ((await response.json()) as { file: string }).file;
    ({ id: textbookId } = await teacher.teacher.textbooks.create({
      title: "Period set",
      level: "A2",
      books: [{ kind: "students_book", name: "book.pdf", file }],
      tracks: [],
    }));
    for (let i = 0; i < 100 && (await teacher.teacher.textbooks.get({ id: textbookId })).books[0]!.status !== "done"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const bookLesson = (title: string, from: number) => ({ title, pages: { students_book: { from, to: from } }, tracks: [], words: [] });
    const { revision } = await teacher.teacher.textbooks.structure({ id: textbookId });
    await teacher.teacher.textbooks.saveStructure({
      id: textbookId,
      structure: { units: [{ title: "Unit 1", lessons: [bookLesson("1.1", 1), bookLesson("1.2", 2)] }, { title: "Unit 2", lessons: [bookLesson("2.1", 3), bookLesson("2.2", 4)] }] },
      revision,
      confirm: true,
    });
    const structure = (await teacher.teacher.textbooks.structure({ id: textbookId })).structure!;
    bookLessons = Object.fromEntries(structure.units.flatMap((u) => u.lessons).map((l) => [l.title, l.id!]));
  });

  async function onTextbook(firstName: string) {
    const studentId = await newStudent(firstName);
    await teacher.teacher.prep.setStudentTextbook({ studentId, textbookId, passedLessonId: bookLessons["1.1"]! });
    return studentId;
  }

  async function held(studentId: string, unit: string | null, startsAt: Date, status = "held") {
    await db().insert(lesson).values({ teacherId, studentId, startsAt, durationMinutes: 60, status, unit });
  }

  it("is the last 30 days without an approved assessment: the textbook lessons finished and the words added in it", async () => {
    const studentId = await onTextbook("Период без замера");
    const now = Date.now();
    await held(studentId, "Unit 1 · 1.2", new Date(now - 40 * DAY));
    await held(studentId, "Unit 2 · 2.1", new Date(now - 20 * DAY));
    await held(studentId, "Unit 2 · 2.2", new Date(now - 5 * DAY));
    await held(studentId, null, new Date(now - 4 * DAY));
    // What the teacher typed in «Юнит» when marking by hand is hers alone (#82).
    await held(studentId, "Юнит 731, повторяли дома", new Date(now - 4 * DAY));
    await held(studentId, "Unit 1 · 1.1", new Date(now - 3 * DAY), "missed");
    for (const word of ["lantern", "compass", "pebble"]) await teacher.teacher.students.addWord({ studentId, word, translation: "", example: "" });
    await db()
      .update(vocabularyWord)
      .set({ createdAt: new Date(now - 45 * DAY) })
      .where(and(eq(vocabularyWord.studentId, studentId), eq(vocabularyWord.word, "lantern")));

    const context = await assistant.agent.studentContext({ studentId });
    const period = context.assessmentPeriod;
    expect(period.lastAssessmentAt).toBeNull();
    expect(Math.round((now - new Date(period.since).getTime()) / DAY)).toBe(30);
    expect(period.coveredUnits.map((u) => u.unit)).toEqual(["Unit 2 · 2.1", "Unit 2 · 2.2"]);
    expect(JSON.stringify(context)).not.toContain("Юнит 731");
    expect(period.words.map((w) => w.word).sort()).toEqual(["compass", "pebble"]);
    const ids = new Set((await assistant.agent.studentWords({ studentId })).map((w) => w.id));
    for (const word of period.words) expect(ids.has(word.id)).toBe(true);
  });

  it("starts at the latest approval, and a draft does not move it", async () => {
    const studentId = await onTextbook("Период после замера");
    const now = Date.now();
    for (const [title, daysAgo] of [
      ["Older", 50],
      ["Latest", 10],
    ] as const) {
      const { id } = await assistant.agent.saveAssessmentDraft({ studentId, assessment: draft(title) });
      await teacher.teacher.assessments.approve({ assessmentId: id, revision: await seen(id) });
      await db().update(assessment).set({ approvedAt: new Date(now - daysAgo * DAY) }).where(eq(assessment.id, id));
    }
    await assistant.agent.saveAssessmentDraft({ studentId, assessment: draft("Still a draft") });
    await held(studentId, "Unit 1 · 1.2", new Date(now - 20 * DAY));
    await held(studentId, "Unit 2 · 2.1", new Date(now - 2 * DAY));

    const { assessmentPeriod: period } = await assistant.agent.studentContext({ studentId });
    expect(Math.round((now - new Date(period.lastAssessmentAt!).getTime()) / DAY)).toBe(10);
    expect(period.since).toBe(period.lastAssessmentAt);
    expect(period.coveredUnits.map((u) => u.unit)).toEqual(["Unit 2 · 2.1"]);
  });

  it("has no covered lessons without a textbook", async () => {
    const studentId = await newStudent("Период без учебника");
    await held(studentId, "Unit 2 · 2.1", new Date(Date.now() - 2 * DAY));
    expect((await assistant.agent.studentContext({ studentId })).assessmentPeriod.coveredUnits).toEqual([]);
  });
});
