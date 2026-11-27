import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "../../db/client";
import { env } from "../../env";
import { pdf } from "../../testing/files";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest, handleTextbookUpload } from "../index";

// «Подготовка» (#151): the next book lesson proposed from the passed one, the
// plan saved and approved by the teacher, the assistant's draft, the homework
// draft for the lesson. The textbook, the material and the homework are
// synthetic.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacherHeaders: Headers;
let teacher: ReturnType<typeof createServerCaller>;
let other: ReturnType<typeof createServerCaller>;
let assistant: ReturnType<typeof createServerCaller>;
let otherAssistant: ReturnType<typeof createServerCaller>;
let assistantToken: string;
let textbookId: string;
let lessons: { id: string; title: string }[];
let gameId: string;

const isoIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function newStudent(firstName: string, passed: string | null) {
  const { id: studentId } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  await teacher.teacher.prep.setStudentTextbook({ studentId, textbookId, passedLessonId: passed ? lessons.find((l) => l.title === passed)!.id : null });
  return studentId;
}

const addLesson = async (studentId: string, days: number) =>
  (await teacher.teacher.schedule.addLesson({ studentId, date: isoIn(days), time: "10:00", durationMinutes: 45, intro: false })).id;

const book = (title: string, skip = "") => ({ type: "book" as const, lessonId: lessons.find((l) => l.title === title)!.id, skip, minutes: 20 });

beforeAll(async () => {
  teacherHeaders = await signedInHeaders(teacherA);
  teacher = createServerCaller(teacherHeaders);
  other = createServerCaller(await signedInHeaders(teacherB));
  assistantToken = (await teacher.teacher.assistant.createToken()).token;
  assistant = createServerCaller(new Headers({ authorization: `Bearer ${assistantToken}` }));
  otherAssistant = createServerCaller(new Headers({ authorization: `Bearer ${(await other.teacher.assistant.createToken()).token}` }));

  const response = await handleTextbookUpload(
    new Request(`${env().APP_URL}/api/files/textbooks?kind=book`, { method: "PUT", headers: teacherHeaders, body: new Uint8Array(pdf(6)) }),
  );
  const file = ((await response.json()) as { file: string }).file;
  ({ id: textbookId } = await teacher.teacher.textbooks.create({
    title: "Prep set",
    level: "A2",
    books: [{ kind: "students_book", name: "book.pdf", file }],
    tracks: [],
  }));
  for (let i = 0; i < 100 && (await teacher.teacher.textbooks.get({ id: textbookId })).books[0]!.status !== "done"; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const lesson = (title: string, from: number) => ({ title, pages: { students_book: { from, to: from + 1 } }, tracks: [], words: [] });
  const { revision } = await teacher.teacher.textbooks.structure({ id: textbookId });
  await teacher.teacher.textbooks.saveStructure({
    id: textbookId,
    structure: { units: [{ title: "Unit 1", lessons: [lesson("1.1", 1), lesson("1.2", 3), lesson("1.3", 5)] }] },
    revision,
    confirm: true,
  });
  lessons = (await teacher.teacher.textbooks.structure({ id: textbookId })).structure!.units[0]!.lessons.map((l) => ({ id: l.id!, title: l.title }));
  ({ id: gameId } = await teacher.teacher.library.addGame({
    title: "Prep int game",
    level: "A2",
    topic: "prep",
    ageGroup: "younger",
    html: "<!doctype html><title>g</title><h1>g</h1>",
  }));
});

afterAll(closeDb);

describe("lesson preparation", () => {
  it("proposes the lesson after the passed one; a held lesson's plan moves it on, unless the card is set later", async () => {
    const studentId = await newStudent("Предложение урока", "1.1");
    const upcoming = await addLesson(studentId, 2);
    expect((await teacher.teacher.prep.get({ lessonId: upcoming })).proposed.stages).toEqual([{ ...book("1.2"), minutes: 45 }]);

    // A lesson planned with 1.2 and then held: 1.3 comes next.
    const past = await addLesson(studentId, -1);
    await teacher.teacher.prep.save({ lessonId: past, plan: { stages: [book("1.2")] }, homeworkId: null, revision: "" });
    await teacher.teacher.schedule.mark({ lessonId: past, status: "held", charged: false, unit: "", note: "" });
    expect((await teacher.teacher.prep.get({ lessonId: upcoming })).proposed.stages[0]).toMatchObject({ ...book("1.3"), minutes: 45 });
    expect((await teacher.teacher.prep.studentTextbook({ studentId })).passedLessonId).toBe(book("1.2").lessonId);

    // The card set after the mark wins.
    await teacher.teacher.prep.setStudentTextbook({ studentId, textbookId, passedLessonId: book("1.1").lessonId });
    expect((await teacher.teacher.prep.get({ lessonId: upcoming })).proposed.stages[0]).toMatchObject({ ...book("1.2"), minutes: 45 });
    // At the end of the book nothing is proposed; without a textbook neither.
    await teacher.teacher.prep.setStudentTextbook({ studentId, textbookId, passedLessonId: book("1.3").lessonId });
    expect((await teacher.teacher.prep.get({ lessonId: upcoming })).proposed.stages).toEqual([]);
    await teacher.teacher.prep.setStudentTextbook({ studentId, textbookId: null, passedLessonId: null });
    expect((await teacher.teacher.prep.get({ lessonId: upcoming })).proposed.stages).toEqual([]);
  });

  it("saves the teacher's plan with a homework draft for the lesson, which stays a draft; the lesson is prepared", async () => {
    const studentId = await newStudent("Сохранённый план", "1.2");
    const lessonId = await addLesson(studentId, 2);
    const { id: homeworkId } = await teacher.teacher.homework.import({
      studentId,
      json: JSON.stringify({ version: 1, title: "Prep int homework", tasks: [{ type: "written", prompt: "Write." }] }),
    });
    expect((await teacher.teacher.prep.list({ studentId }))[0]).toMatchObject({ id: lessonId, prepared: false });

    const plan = { stages: [{ type: "material" as const, materialId: gameId, minutes: 5 }, book("1.3", "3, 5")] };
    await teacher.teacher.prep.save({ lessonId, plan, homeworkId, revision: "" });
    expect(await teacher.teacher.prep.get({ lessonId })).toMatchObject({ plan, draft: null, homeworkId });
    expect((await teacher.teacher.prep.list({ studentId }))[0]).toMatchObject({ prepared: true });
    expect((await teacher.teacher.homework.list({ studentId })).find((h) => h.id === homeworkId)).toMatchObject({ status: "draft" });

    // Refused: another student's homework, a published one, a lesson not in the textbook, another teacher's material.
    const elsewhere = await newStudent("Чужая домашка", null);
    const { id: foreign } = await teacher.teacher.homework.import({
      studentId: elsewhere,
      json: JSON.stringify({ version: 1, title: "x", tasks: [{ type: "written", prompt: "Write." }] }),
    });
    const { revision } = await teacher.teacher.prep.get({ lessonId });
    for (const [input, message] of [
      [{ plan, homeworkId: foreign }, /черновик этого ученика/],
      [{ plan: { stages: [{ ...book("1.1"), lessonId: crypto.randomUUID() }] }, homeworkId: null }, /нет в учебнике ученика/],
      [{ plan: { stages: [{ type: "material", materialId: crypto.randomUUID(), minutes: 5 }] }, homeworkId: null }, /нет в библиотеке/],
    ] as const) {
      await expect(teacher.teacher.prep.save({ lessonId, revision, ...input })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringMatching(message),
      });
    }
    // A held lesson is no longer prepared here.
    const held = await addLesson(studentId, -1);
    await teacher.teacher.schedule.mark({ lessonId: held, status: "held", charged: false, unit: "", note: "" });
    await expect(teacher.teacher.prep.get({ lessonId: held })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await teacher.teacher.prep.list({ studentId })).map((l) => l.id)).not.toContain(held);
  });

  it("keeps the assistant's plan as a draft until the teacher approves it, and refuses an approval over a newer draft", async () => {
    const studentId = await newStudent("План ассистента", "1.2");
    const lessonId = await addLesson(studentId, 3);
    expect((await assistant.agent.upcomingLessons({ studentId })).map((l) => l.id)).toEqual([lessonId]);
    expect(await assistant.agent.lessonPlan({ lessonId })).toMatchObject({ plan: null, proposed: { stages: [{ ...book("1.3"), minutes: 45 }] } });
    expect((await assistant.agent.lessonMaterials({ lessonId })).map((m) => m.id)).toContain(gameId);

    const draft = { stages: [book("1.3", "2"), { type: "material" as const, materialId: gameId, minutes: 10 }] };
    expect(await assistant.agent.saveLessonPlan({ lessonId, plan: draft })).toEqual({ status: "draft" });
    const loaded = await teacher.teacher.prep.get({ lessonId });
    expect(loaded).toMatchObject({ draft, plan: null });
    expect((await teacher.teacher.prep.list({ studentId }))[0]).toMatchObject({ prepared: false, draft: true });

    // The assistant revises after the teacher's page loaded: her approval of the old one is refused.
    await assistant.agent.saveLessonPlan({ lessonId, plan: { stages: [book("1.3")] } });
    await expect(
      teacher.teacher.prep.save({ lessonId, plan: { stages: [draft.stages[0]!] }, homeworkId: null, revision: loaded.revision }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const fresh = await teacher.teacher.prep.get({ lessonId });
    await teacher.teacher.prep.save({ lessonId, plan: fresh.draft, homeworkId: null, revision: fresh.revision });
    expect(await teacher.teacher.prep.get({ lessonId })).toMatchObject({ plan: { stages: [book("1.3")] }, draft: null });
    // The assistant's plan is checked like the teacher's.
    await expect(assistant.agent.saveLessonPlan({ lessonId, plan: { stages: [{ type: "material", materialId: crypto.randomUUID(), minutes: 1 }] } })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("never lets the assistant approve, and another teacher and their assistant never reach the lesson", async () => {
    const studentId = await newStudent("Чужой урок", "1.2");
    const lessonId = await addLesson(studentId, 3);
    const call = (procedure: string) =>
      handleRouterRequest(
        new Request(`${env().APP_URL}/api/trpc/${procedure}`, {
          method: "POST",
          headers: { authorization: `Bearer ${assistantToken}`, "content-type": "application/json" },
          body: JSON.stringify({ lessonId }),
        }),
      );
    expect((await call("agent.approveLessonPlan")).status).toBe((await call("agent.noSuchProcedure")).status);
    await expect(assistant.teacher.prep.save({ lessonId, plan: { stages: [] }, homeworkId: null, revision: "" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    for (const attempt of [
      () => other.teacher.prep.get({ lessonId }),
      () => other.teacher.prep.save({ lessonId, plan: { stages: [] }, homeworkId: null, revision: "" }),
      () => other.teacher.prep.studentTextbook({ studentId }),
      () => otherAssistant.agent.lessonPlan({ lessonId }),
      () => otherAssistant.agent.saveLessonPlan({ lessonId, plan: { stages: [] } }),
      () => otherAssistant.agent.lessonMaterials({ lessonId }),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect((await otherAssistant.agent.upcomingLessons({})).map((l) => l.id)).not.toContain(lessonId);
    await expect(other.teacher.prep.setStudentTextbook({ studentId, textbookId: null, passedLessonId: null })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("shows the previous held or missed lesson above the plan, none before the first; another teacher never reaches it (#426)", async () => {
    const studentId = await newStudent("Прошлый урок", "1.1");
    const upcoming = await addLesson(studentId, 2);
    expect(await teacher.teacher.prep.previousLesson({ lessonId: upcoming })).toBeNull();

    const held = await addLesson(studentId, -2);
    await teacher.teacher.prep.save({ lessonId: held, plan: { stages: [book("1.2", "3")] }, homeworkId: null, revision: "" });
    await teacher.teacher.schedule.mark({ lessonId: held, status: "held", charged: true, unit: "Unit 1 · 1.2", note: "Повторить was/were" });
    expect(await teacher.teacher.prep.previousLesson({ lessonId: upcoming })).toMatchObject({
      status: "held",
      bookLesson: "Unit 1 · 1.2",
      stages: [{ kind: "book", title: "Unit 1 · 1.2", skip: "3" }],
      note: "Повторить was/were",
    });

    const missed = await addLesson(studentId, -1);
    await teacher.teacher.schedule.mark({ lessonId: missed, status: "missed", charged: false, unit: "", note: "" });
    expect(await teacher.teacher.prep.previousLesson({ lessonId: upcoming })).toMatchObject({ status: "missed", stages: [], note: null });

    await expect(other.teacher.prep.previousLesson({ lessonId: upcoming })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
