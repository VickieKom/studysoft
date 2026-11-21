import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HomeworkDocument } from "../../../domain/homework-format";
import pictures from "../../../../../deploy/seed/homework/demo-picture-options.json";
import { closeDb, db } from "../../db/client";
import { homework, lessonPlan } from "../../db/schema";
import { env } from "../../env";
import { pdf } from "../../testing/files";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleTextbookUpload } from "../index";

// A lesson's homework built from the task bank (#226): the checked confirmed
// tasks of the plan's book lesson make a new draft attached to the lesson, or
// are appended to the draft attached; they are copies, so editing the bank
// afterwards (#225) leaves the built draft as it was. The textbook and the
// tasks are synthetic.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacherHeaders: Headers;
let teacher: ReturnType<typeof createServerCaller>;
let other: ReturnType<typeof createServerCaller>;
let assistant: ReturnType<typeof createServerCaller>;
let textbookId: string;
let lessons: { id: string; title: string }[];

const isoIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const workbook = (exercise: string) => ({ book: "Workbook", unit: "1", page: "5", exercise });
const choice = (prompt: string, exercise: string) => ({
  type: "single_choice",
  prompt,
  options: ["yellow", "purple"],
  answer: 0,
  topic: "colours",
  skill: "vocabulary",
  source: workbook(exercise),
});
const bankTasks = [choice("Bank task one.", "1"), choice("Bank task two.", "2"), choice("Bank task three.", "3")];

/** A student who passed 1.1, so their next lesson's book stage is 1.2, and a lesson with them in two days. */
async function lessonFor(firstName: string) {
  const { id: studentId } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  await teacher.teacher.prep.setStudentTextbook({ studentId, textbookId, passedLessonId: lessons[0]!.id });
  const { id: lessonId } = await teacher.teacher.schedule.addLesson({ studentId, date: isoIn(2), time: "10:00", durationMinutes: 45, intro: false });
  return { studentId, lessonId };
}

/** Lesson 1.2's bank confirmed with `tasks`. */
async function confirmBank(tasks: unknown[]) {
  await assistant.agent.saveTextbookLessonTasks({ textbookId, lessonId: lessons[1]!.id, tasks });
  const lesson = (await teacher.teacher.textbooks.taskBank({ id: textbookId })).find((l) => l.lessonId === lessons[1]!.id)!;
  await teacher.teacher.textbooks.confirmBankLesson({ textbookId, lessonId: lessons[1]!.id, revision: lesson.draft!.revision });
}

const documentOf = async (id: string) => (await db().select({ document: homework.document }).from(homework).where(eq(homework.id, id)))[0]!.document as HomeworkDocument;
const attachedTo = async (lessonId: string) => (await db().select({ id: lessonPlan.homeworkId }).from(lessonPlan).where(eq(lessonPlan.lessonId, lessonId)))[0]?.id;

beforeAll(async () => {
  teacherHeaders = await signedInHeaders(teacherA);
  teacher = createServerCaller(teacherHeaders);
  other = createServerCaller(await signedInHeaders(teacherB));
  assistant = createServerCaller(new Headers({ authorization: `Bearer ${(await teacher.teacher.assistant.createToken()).token}` }));
  const response = await handleTextbookUpload(
    new Request(`${env().APP_URL}/api/files/textbooks?kind=book`, { method: "PUT", headers: teacherHeaders, body: new Uint8Array(pdf(6)) }),
  );
  const file = ((await response.json()) as { file: string }).file;
  ({ id: textbookId } = await teacher.teacher.textbooks.create({ title: "Bank prep set", level: "A2", books: [{ kind: "students_book", name: "book.pdf", file }], tracks: [] }));
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
});

afterAll(closeDb);

describe("a homework built from the task bank", () => {
  it("is a new draft «Домашка: урок 1.2» attached to the lesson, then grows; an edit of the bank leaves it as built", async () => {
    await confirmBank(bankTasks);
    const { studentId, lessonId } = await lessonFor("Сборка из банка");
    const [shown] = await teacher.teacher.prep.bankTasks({ lessonId });
    expect(shown).toMatchObject({ bookLessonId: lessons[1]!.id, title: "1.2", textbookId });
    expect(shown!.confirmed!.tasks.map((t) => t.task.prompt)).toEqual(bankTasks.map((t) => t.prompt));
    // As the child sees them: no keys.
    expect(JSON.stringify(shown)).not.toMatch(/"answers?"/);

    const revision = shown!.confirmed!.revision;
    const { homeworkId } = await teacher.teacher.prep.buildHomework({ lessonId, bookLessonId: lessons[1]!.id, picks: [2, 0], revision, homeworkId: null });
    const built = await teacher.teacher.homework.get({ id: homeworkId });
    expect(built).toMatchObject({ title: "Домашка: урок 1.2", status: "draft" });
    // In the bank's order, keys and sources included.
    expect(built.tasks).toEqual([bankTasks[0], bankTasks[2]]);
    expect(await attachedTo(lessonId)).toBe(homeworkId);
    expect((await teacher.teacher.prep.get({ lessonId })).homeworkId).toBe(homeworkId);
    expect((await teacher.teacher.homework.list({ studentId })).map((h) => h.id)).toContain(homeworkId);

    // Built again with the draft attached: appended.
    await teacher.teacher.prep.buildHomework({ lessonId, bookLessonId: lessons[1]!.id, picks: [1], revision, homeworkId });
    expect((await documentOf(homeworkId)).tasks.map((t) => t.prompt)).toEqual(["Bank task one.", "Bank task three.", "Bank task two."]);

    // The bank is edited afterwards (#225): the built draft keeps its copy.
    const { tasks, revision: bankRevision } = await teacher.teacher.textbooks.bankLessonTasks({ textbookId, lessonId: lessons[1]!.id });
    await teacher.teacher.textbooks.updateBankTask({ textbookId, lessonId: lessons[1]!.id, index: 0, revision: bankRevision, task: { ...tasks[0]!, prompt: "Bank task one, fixed." } });
    expect((await documentOf(homeworkId)).tasks[0]!.prompt).toBe("Bank task one.");
    // And a page that showed the bank before the edit cannot build from places that may name other tasks now.
    await expect(teacher.teacher.prep.buildHomework({ lessonId, bookLessonId: lessons[1]!.id, picks: [0], revision, homeworkId })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect((await documentOf(homeworkId)).tasks).toHaveLength(3);
  });

  it("copies a task's stored pictures by reference, and the built draft serves them", async () => {
    await confirmBank([{ ...pictures.tasks[0]!, source: workbook("6") }]);
    const { lessonId } = await lessonFor("Картинки из банка");
    const [shown] = await teacher.teacher.prep.bankTasks({ lessonId });
    const { homeworkId } = await teacher.teacher.prep.buildHomework({
      lessonId,
      bookLessonId: lessons[1]!.id,
      picks: [0],
      revision: shown!.confirmed!.revision,
      homeworkId: null,
    });
    const { tasks } = await teacher.teacher.textbooks.bankLessonTasks({ textbookId, lessonId: lessons[1]!.id });
    expect((await documentOf(homeworkId)).tasks[0]).toEqual(tasks[0]);
    expect(JSON.stringify(tasks[0])).toMatch(/"blob:[0-9a-f-]{36}"/);
  });

  it("refuses nothing checked, a draft that is not this student's, another teacher; a lesson without a bank shows none", async () => {
    await confirmBank(bankTasks);
    const { lessonId } = await lessonFor("Проверки сборки");
    const other_ = await lessonFor("Другой ученик сборки");
    const [shown] = await teacher.teacher.prep.bankTasks({ lessonId });
    const revision = shown!.confirmed!.revision;
    await expect(teacher.teacher.prep.buildHomework({ lessonId, bookLessonId: lessons[1]!.id, picks: [], revision, homeworkId: null })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(teacher.teacher.prep.buildHomework({ lessonId, bookLessonId: lessons[1]!.id, picks: [5], revision, homeworkId: null })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    // Another student's draft cannot be the lesson's.
    const { homeworkId: theirs } = await teacher.teacher.prep.buildHomework({
      lessonId: other_.lessonId,
      bookLessonId: lessons[1]!.id,
      picks: [0],
      revision,
      homeworkId: null,
    });
    await expect(teacher.teacher.prep.buildHomework({ lessonId, bookLessonId: lessons[1]!.id, picks: [0], revision, homeworkId: theirs })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect((await documentOf(theirs)).tasks).toHaveLength(1);
    for (const call of [
      () => other.teacher.prep.bankTasks({ lessonId }),
      () => other.teacher.prep.buildHomework({ lessonId, bookLessonId: lessons[1]!.id, picks: [0], revision, homeworkId: null }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect(await attachedTo(lessonId)).toBeUndefined();

    // A lesson whose book lesson has no confirmed bank: none to pick, and nothing to build from.
    await teacher.teacher.prep.save({ lessonId, plan: { stages: [{ type: "book", lessonId: lessons[2]!.id, skip: "", minutes: 30 }] }, homeworkId: null, revision: "" });
    expect(await teacher.teacher.prep.bankTasks({ lessonId })).toEqual([{ bookLessonId: lessons[2]!.id, title: "1.3", textbookId, confirmed: null }]);
    await expect(teacher.teacher.prep.buildHomework({ lessonId, bookLessonId: lessons[2]!.id, picks: [0], revision, homeworkId: null })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("waits while another change holds the attached draft, then appends after it", async () => {
    await confirmBank(bankTasks);
    const { lessonId } = await lessonFor("Сборка в очереди");
    const [shown] = await teacher.teacher.prep.bankTasks({ lessonId });
    const revision = shown!.confirmed!.revision;
    const { homeworkId } = await teacher.teacher.prep.buildHomework({ lessonId, bookLessonId: lessons[1]!.id, picks: [0], revision, homeworkId: null });

    let locked!: () => void;
    let release!: () => void;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    // Another build holds the draft's row, as buildHomeworkFromBank does, and adds a task.
    const holding = db().transaction(async (tx) => {
      const [row] = await tx.select({ document: homework.document }).from(homework).where(eq(homework.id, homeworkId)).for("update");
      locked();
      await released;
      const document = row!.document as HomeworkDocument;
      await tx.update(homework).set({ document: { ...document, tasks: [...document.tasks, bankTasks[1]] } }).where(eq(homework.id, homeworkId));
    });
    await isLocked;

    const building = teacher.teacher.prep.buildHomework({ lessonId, bookLessonId: lessons[1]!.id, picks: [2], revision, homeworkId }).then(
      () => "built",
      (error: unknown) => error,
    );
    const waiting = await Promise.race([building, new Promise((resolve) => setTimeout(() => resolve("waiting"), 300))]);
    expect(waiting).toBe("waiting");

    release();
    await holding;
    expect(await building).toBe("built");
    // Neither change is lost.
    expect((await documentOf(homeworkId)).tasks.map((t) => t.prompt)).toEqual(["Bank task one.", "Bank task two.", "Bank task three."]);
  });
});
