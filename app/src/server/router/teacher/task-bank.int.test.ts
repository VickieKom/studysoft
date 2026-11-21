import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pictures from "../../../../../deploy/seed/homework/demo-picture-options.json";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { removeUnreferencedBlobs } from "../../blob/store";
import { closeDb, db } from "../../db/client";
import { blob, textbookLessonTasks } from "../../db/schema";
import { env } from "../../env";
import { pdf } from "../../testing/files";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleBankFileRequest, handleRouterRequest, handleTextbookUpload } from "../index";

// The workbook task bank (#224): the assistant saves a textbook lesson's
// tasks as its draft; the teacher removes some and confirms the lesson; a
// later save lies beside the confirmed tasks until she confirms it. The bank
// is the teacher's only: no student or parent procedure returns it, and its
// pictures are served to her alone. The textbook and the tasks are synthetic.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacherHeaders: Headers;
let teacher: ReturnType<typeof createServerCaller>;
let other: ReturnType<typeof createServerCaller>;
let assistant: ReturnType<typeof createServerCaller>;
let otherAssistant: ReturnType<typeof createServerCaller>;

// A word no other test uses, to look for in what students and parents get.
const MARKER = `bankmarker${crypto.randomUUID().slice(0, 8)}`;
const workbook = (page: string, exercise: string) => ({ book: "Workbook", unit: "1", page, exercise });
const choice = (prompt: string, exercise: string) => ({
  type: "single_choice",
  prompt,
  options: ["kennel", "kettle"],
  answer: 0,
  topic: "home",
  skill: "vocabulary",
  source: workbook("5", exercise),
});
const gap = {
  type: "gap",
  prompt: `Complete the sentence ${MARKER}.`,
  text: "The owl ___ at night.",
  answers: [["hoots"]],
  topic: "present simple",
  skill: "grammar",
  source: workbook("5", "2"),
};
const skipped = [{ source: workbook("5", "4"), reason: "аудирование без записи" }];

async function upload(bytes: Buffer) {
  const response = await handleTextbookUpload(
    new Request(`${env().APP_URL}/api/files/textbooks?kind=book`, { method: "PUT", headers: teacherHeaders, body: new Uint8Array(bytes) }),
  );
  return ((await response.json()) as { file: string }).file;
}

/** A rendered six-page book with lessons 1.1 and 1.2; with `confirm`, its structure confirmed. Returns its id and lesson 1.2's. */
async function newTextbook(title: string, confirm = true) {
  const { id } = await teacher.teacher.textbooks.create({
    title,
    level: "A2",
    books: [{ kind: "students_book", name: "book.pdf", file: await upload(pdf(6)) }],
    tracks: [],
  });
  for (let i = 0; i < 100 && !(await teacher.teacher.textbooks.get({ id })).books.every((b) => b.status === "done"); i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const lesson = (name: string, from: number) => ({ title: name, pages: { students_book: { from, to: from + 1 } }, tracks: [], words: [] });
  await assistant.agent.saveTextbookStructure({ textbookId: id, structure: { units: [{ title: "Unit 1", lessons: [lesson("1.1", 1), lesson("1.2", 3)] }] } });
  const draft = await teacher.teacher.textbooks.structure({ id });
  if (!confirm) return { id, lessonId: draft.draft!.units[0]!.lessons[1]!.id! };
  await teacher.teacher.textbooks.saveStructure({ id, structure: draft.draft, revision: draft.revision, confirm: true });
  const { structure } = await teacher.teacher.textbooks.structure({ id });
  return { id, lessonId: structure!.units[0]!.lessons[1]!.id! };
}

const lessonOf = async (textbookId: string, lessonId: string, as = teacher) =>
  (await as.teacher.textbooks.taskBank({ id: textbookId })).find((l) => l.lessonId === lessonId)!;
const prompts = (list: { tasks: { task: { prompt: string } }[] } | null) => list?.tasks.map((t) => t.task.prompt) ?? null;

async function studentSession(firstName: string) {
  const { id: studentId } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  const exchange = async (role: "student" | "parent") => {
    const url = role === "student" ? (await teacher.teacher.links.student({ studentId })).url : (await teacher.teacher.links.parent({ studentId })).url;
    const response = await handleRouterRequest(
      new Request(`${env().APP_URL}/api/trpc/links.exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: url.split("#")[1]! }),
      }),
    );
    const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES[role]}=`))!.split(";")[0]!;
    return new Headers({ cookie });
  };
  return { student: await exchange("student"), parent: await exchange("parent") };
}

async function bankFile(headers: Headers, entryId: string, list: string, task: string, picture: string) {
  const request = new Request(`${env().APP_URL}/api/files/bank/${entryId}/${list}/${task}/pictures/${picture}`, { headers });
  const response = await handleBankFileRequest(request, entryId, list, task, { picture });
  return { status: response.status, type: response.headers.get("content-type") };
}

beforeAll(async () => {
  teacherHeaders = await signedInHeaders(teacherA);
  teacher = createServerCaller(teacherHeaders);
  other = createServerCaller(await signedInHeaders(teacherB));
  assistant = createServerCaller(new Headers({ authorization: `Bearer ${(await teacher.teacher.assistant.createToken()).token}` }));
  otherAssistant = createServerCaller(new Headers({ authorization: `Bearer ${(await other.teacher.assistant.createToken()).token}` }));
});

afterAll(closeDb);

describe("the task bank", () => {
  it("keeps the assistant's tasks as the lesson's draft, without keys in the teacher's view, until she confirms them", async () => {
    const { id, lessonId } = await newTextbook("Bank set");
    const tasks = [choice("Choose the little house.", "1"), gap, choice("Choose the pot.", "3")];
    expect(await assistant.agent.saveTextbookLessonTasks({ textbookId: id, lessonId, tasks, skipped })).toEqual({ status: "draft" });

    const bank = await teacher.teacher.textbooks.taskBank({ id });
    expect(bank.map((l) => l.title)).toEqual(["1.1", "1.2"]);
    const lesson = bank[1]!;
    expect(lesson).toMatchObject({ unit: "Unit 1", confirmed: null, draft: { skipped } });
    expect(prompts(lesson.draft)).toEqual(tasks.map((t) => t.prompt));
    expect(lesson.draft!.tasks[1]!.source).toEqual(workbook("5", "2"));
    // As the child sees them: no keys.
    const shown = JSON.stringify(lesson.draft);
    expect(shown).not.toContain("hoots");
    expect(shown).not.toMatch(/"answers?"/);

    // «Убрать» the third task, then «Подтвердить урок».
    await teacher.teacher.textbooks.removeBankTask({ textbookId: id, lessonId, index: 2, revision: lesson.draft!.revision });
    const removed = await lessonOf(id, lessonId);
    expect(prompts(removed.draft)).toEqual([tasks[0]!.prompt, gap.prompt]);
    await teacher.teacher.textbooks.confirmBankLesson({ textbookId: id, lessonId, revision: removed.draft!.revision });
    const confirmed = await lessonOf(id, lessonId);
    expect(confirmed).toMatchObject({ draft: null, confirmed: { skipped } });
    expect(prompts(confirmed.confirmed)).toEqual([tasks[0]!.prompt, gap.prompt]);

    // Saved again, with a task from the Student's Book: the confirmed tasks stay, the new draft lies beside them.
    const fromBook = { ...choice("Choose from the book.", "3"), source: { book: "Student's Book", page: "4", exercise: "3" } };
    await assistant.agent.saveTextbookLessonTasks({ textbookId: id, lessonId, tasks: [fromBook] });
    const again = await lessonOf(id, lessonId);
    expect(prompts(again.confirmed)).toEqual([tasks[0]!.prompt, gap.prompt]);
    expect(again.draft).toMatchObject({ skipped: [], tasks: [{ task: { prompt: fromBook.prompt }, source: { book: "Student's Book" } }] });
    // Confirming it replaces the lesson's tasks.
    await teacher.teacher.textbooks.confirmBankLesson({ textbookId: id, lessonId, revision: again.draft!.revision });
    expect(prompts((await lessonOf(id, lessonId)).confirmed)).toEqual([fromBook.prompt]);
  });

  it("refuses a draft that fails the format or has no book source, and a lesson not in the confirmed structure; nothing is saved", async () => {
    const { id, lessonId } = await newTextbook("Checked bank set");
    const cases: [unknown, RegExp][] = [
      [[{ ...gap, prompt: "" }], /Задание 1/],
      [[{ ...gap, source: undefined }], /Задание 1, поле source/],
      [[{ ...gap, source: "own" }], /Задание 1, поле source/],
      ["not a list", /tasks/],
    ];
    for (const [tasks, message] of cases) {
      await expect(assistant.agent.saveTextbookLessonTasks({ textbookId: id, lessonId, tasks })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringMatching(message),
      });
    }
    await expect(
      assistant.agent.saveTextbookLessonTasks({ textbookId: id, lessonId, tasks: [gap], skipped: [{ source: workbook("5", "4"), reason: "" }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/skipped/) });
    expect(await lessonOf(id, lessonId)).toMatchObject({ confirmed: null, draft: null });

    // A lesson the structure does not have, and a lesson of a structure not yet confirmed: not found.
    await expect(assistant.agent.saveTextbookLessonTasks({ textbookId: id, lessonId: crypto.randomUUID(), tasks: [gap] })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const draftOnly = await newTextbook("Unconfirmed bank set", false);
    await expect(assistant.agent.saveTextbookLessonTasks({ textbookId: draftOnly.id, lessonId: draftOnly.lessonId, tasks: [gap] })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await db().select().from(textbookLessonTasks).where(eq(textbookLessonTasks.textbookId, draftOnly.id))).toHaveLength(0);
  });

  it("refuses «Убрать» and «Подтвердить урок» from a page loaded before the assistant's next save", async () => {
    const { id, lessonId } = await newTextbook("Raced bank set");
    await assistant.agent.saveTextbookLessonTasks({ textbookId: id, lessonId, tasks: [gap, choice("First save.", "1")] });
    // The teacher's page reads the draft.
    const loaded = await lessonOf(id, lessonId);
    // The assistant saves again before she clicks.
    await assistant.agent.saveTextbookLessonTasks({ textbookId: id, lessonId, tasks: [choice("Second save.", "1")] });
    // Her clicks from the old page are refused, and nothing she did not see is confirmed.
    await expect(teacher.teacher.textbooks.removeBankTask({ textbookId: id, lessonId, index: 0, revision: loaded.draft!.revision })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(teacher.teacher.textbooks.confirmBankLesson({ textbookId: id, lessonId, revision: loaded.draft!.revision })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const now = await lessonOf(id, lessonId);
    expect(now.confirmed).toBeNull();
    expect(prompts(now.draft)).toEqual(["Second save."]);
    // A lesson with no draft has nothing to confirm.
    await teacher.teacher.textbooks.confirmBankLesson({ textbookId: id, lessonId, revision: now.draft!.revision });
    await expect(teacher.teacher.textbooks.confirmBankLesson({ textbookId: id, lessonId, revision: now.draft!.revision })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("keeps a task's pictures in the blob store, serves them to the teacher alone, and the cleanup keeps them", async () => {
    const { id, lessonId } = await newTextbook("Picture bank set");
    const pictureTask = { ...pictures.tasks[0]!, source: workbook("6", "1") };
    await assistant.agent.saveTextbookLessonTasks({ textbookId: id, lessonId, tasks: [pictureTask] });
    const [row] = await db().select().from(textbookLessonTasks).where(eq(textbookLessonTasks.lessonId, lessonId));
    const stored = JSON.stringify(row!.draft);
    expect(stored).not.toContain("data:image");
    const ref = stored.match(/blob:([0-9a-f-]{36})/)![1]!;

    const lesson = await lessonOf(id, lessonId);
    expect(JSON.stringify(lesson.draft!.tasks[0]!.task)).toContain(`/api/files/bank/${row!.id}/draft/0/pictures/0`);
    expect(await bankFile(teacherHeaders, row!.id, "draft", "0", "0")).toEqual({ status: 200, type: "image/png" });

    const { student, parent } = await studentSession("Bankless");
    for (const headers of [new Headers(), await signedInHeaders(teacherB), student, parent]) {
      expect((await bankFile(headers, row!.id, "draft", "0", "0")).status).toBe(404);
    }
    expect((await bankFile(teacherHeaders, row!.id, "tasks", "0", "0")).status).toBe(404);

    await db().update(blob).set({ createdAt: new Date(Date.now() - 48 * 3_600_000) }).where(eq(blob.id, ref));
    await removeUnreferencedBlobs(db());
    expect(await db().select().from(blob).where(eq(blob.id, ref))).toHaveLength(1);
    // Confirmed, the same file is still kept.
    await teacher.teacher.textbooks.confirmBankLesson({ textbookId: id, lessonId, revision: lesson.draft!.revision });
    await removeUnreferencedBlobs(db());
    expect(await db().select().from(blob).where(eq(blob.id, ref))).toHaveLength(1);
    expect(await bankFile(teacherHeaders, row!.id, "tasks", "0", "0")).toEqual({ status: 200, type: "image/png" });
  });

  it("is never returned to a student or a parent, nor to another teacher or her assistant", async () => {
    const { id, lessonId } = await newTextbook("Private bank set");
    await assistant.agent.saveTextbookLessonTasks({ textbookId: id, lessonId, tasks: [gap] });
    const loaded = await lessonOf(id, lessonId);
    await teacher.teacher.textbooks.confirmBankLesson({ textbookId: id, lessonId, revision: loaded.draft!.revision });
    await assistant.agent.saveTextbookLessonTasks({ textbookId: id, lessonId, tasks: [gap] });

    // Every query a student or a parent has: none of them carries a bank task.
    const { student, parent } = await studentSession("Curious");
    const asStudent = createServerCaller(student);
    const asParent = createServerCaller(parent);
    const answers = [
      await asStudent.student.me(),
      await asStudent.student.homework.current(),
      await asStudent.student.games.list(),
      await asStudent.student.videos.list(),
      await asParent.parent.me(),
    ];
    expect(JSON.stringify(answers)).not.toContain(MARKER);
    // The teacher's bank procedures do not open to their sessions.
    for (const caller of [asStudent, asParent]) {
      await expect(caller.teacher.textbooks.taskBank({ id })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await expect(caller.teacher.textbooks.confirmBankLesson({ textbookId: id, lessonId, revision: "" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }

    // Another teacher and her assistant: not found, and nothing changed.
    for (const call of [
      () => other.teacher.textbooks.taskBank({ id }),
      () => other.teacher.textbooks.removeBankTask({ textbookId: id, lessonId, index: 0, revision: loaded.draft!.revision }),
      () => other.teacher.textbooks.confirmBankLesson({ textbookId: id, lessonId, revision: loaded.draft!.revision }),
      () => otherAssistant.agent.saveTextbookLessonTasks({ textbookId: id, lessonId, tasks: [gap] }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    const after = await lessonOf(id, lessonId);
    expect(prompts(after.confirmed)).toEqual([gap.prompt]);
    expect(prompts(after.draft)).toEqual([gap.prompt]);
  });
});

describe("a confirmed task edited in the bank (#225)", () => {
  /** A lesson 1.2 confirmed with the given tasks; returns the ids. */
  async function confirmedLesson(title: string, tasks: unknown[]) {
    const { id, lessonId } = await newTextbook(title);
    await assistant.agent.saveTextbookLessonTasks({ textbookId: id, lessonId, tasks });
    const { draft } = await lessonOf(id, lessonId);
    await teacher.teacher.textbooks.confirmBankLesson({ textbookId: id, lessonId, revision: draft!.revision });
    return { id, lessonId };
  }

  it("opens whole, key included, and saves back with its source; the page shows the new prompt", async () => {
    const { id, lessonId } = await confirmedLesson("Edited bank set", [choice("Choose the house.", "1"), gap]);
    const loaded = await teacher.teacher.textbooks.bankLessonTasks({ textbookId: id, lessonId });
    expect(loaded.tasks[1]).toMatchObject({ type: "gap", answers: [["hoots"]], source: workbook("5", "2") });

    const fixed = { ...loaded.tasks[1]!, prompt: "Complete the fixed sentence.", answers: [["hoots", "calls"]] };
    await teacher.teacher.textbooks.updateBankTask({ textbookId: id, lessonId, index: 1, revision: loaded.revision, task: fixed });
    const after = await teacher.teacher.textbooks.bankLessonTasks({ textbookId: id, lessonId });
    expect(after.tasks[1]).toMatchObject({ prompt: "Complete the fixed sentence.", answers: [["hoots", "calls"]], source: workbook("5", "2") });
    expect(after.tasks[0]).toEqual(loaded.tasks[0]);
    expect(prompts((await lessonOf(id, lessonId)).confirmed)).toEqual(["Choose the house.", "Complete the fixed sentence."]);
  });

  it("refuses an invalid task by its place, one without a book source, and a task the lesson does not have; nothing changes", async () => {
    const { id, lessonId } = await confirmedLesson("Checked edit set", [choice("Choose the house.", "1"), gap]);
    const { tasks, revision } = await teacher.teacher.textbooks.bankLessonTasks({ textbookId: id, lessonId });
    await expect(
      teacher.teacher.textbooks.updateBankTask({ textbookId: id, lessonId, index: 1, revision, task: { ...tasks[1]!, answers: [] } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/^Задание 2/) });
    await expect(
      teacher.teacher.textbooks.updateBankTask({ textbookId: id, lessonId, index: 1, revision, task: { ...tasks[1]!, source: "own" } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/source/) });
    // A stored file from elsewhere cannot be slipped in by its reference.
    await expect(
      teacher.teacher.textbooks.updateBankTask({ textbookId: id, lessonId, index: 1, revision, task: { ...tasks[1]!, image: `blob:${crypto.randomUUID()}` } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(teacher.teacher.textbooks.updateBankTask({ textbookId: id, lessonId, index: 2, revision, task: tasks[1] })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    for (const call of [
      () => other.teacher.textbooks.bankLessonTasks({ textbookId: id, lessonId }),
      () => other.teacher.textbooks.updateBankTask({ textbookId: id, lessonId, index: 1, revision, task: tasks[1] }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect((await teacher.teacher.textbooks.bankLessonTasks({ textbookId: id, lessonId })).tasks).toEqual(tasks);
  });

  it("refuses a save from an editor opened before another save of the lesson's tasks", async () => {
    const { id, lessonId } = await confirmedLesson("Raced edit set", [choice("Choose the house.", "1"), gap]);
    // Two editors read the lesson.
    const first = await teacher.teacher.textbooks.bankLessonTasks({ textbookId: id, lessonId });
    const second = await teacher.teacher.textbooks.bankLessonTasks({ textbookId: id, lessonId });
    // The first saves.
    await teacher.teacher.textbooks.updateBankTask({ textbookId: id, lessonId, index: 0, revision: first.revision, task: { ...first.tasks[0]!, prompt: "First edit." } });
    // The second, loaded before it, is refused rather than overwriting it.
    await expect(
      teacher.teacher.textbooks.updateBankTask({ textbookId: id, lessonId, index: 1, revision: second.revision, task: { ...second.tasks[1]!, prompt: "Second edit." } }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(prompts((await lessonOf(id, lessonId)).confirmed)).toEqual(["First edit.", gap.prompt]);
  });

  it("keeps a stored picture the task already has", async () => {
    const { id, lessonId } = await confirmedLesson("Picture edit set", [{ ...pictures.tasks[0]!, source: workbook("6", "1") }]);
    const { tasks, revision } = await teacher.teacher.textbooks.bankLessonTasks({ textbookId: id, lessonId });
    await teacher.teacher.textbooks.updateBankTask({ textbookId: id, lessonId, index: 0, revision, task: { ...tasks[0]!, prompt: "Which square is red?" } });
    const after = await teacher.teacher.textbooks.bankLessonTasks({ textbookId: id, lessonId });
    expect(after.tasks[0]).toEqual({ ...tasks[0]!, prompt: "Which square is red?" });
  });
});
