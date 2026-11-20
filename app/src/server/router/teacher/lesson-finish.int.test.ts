import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { closeDb, db } from "../../db/client";
import { homework, lesson, student, vocabularyWord } from "../../db/schema";
import { env } from "../../env";
import { pdf } from "../../testing/files";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest, handleTextbookUpload } from "../index";

// «Завершить урок» (#154): one form, applied in one transaction or not at
// all — the lesson held and charged, the note, the book lesson covered, the
// homework published, the words in the student's vocabulary (merged
// regardless of case). The vocabulary reaches the assistant, never the
// student. The textbook, the words and the homework are synthetic.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacherHeaders: Headers;
let teacher: ReturnType<typeof createServerCaller>;
let other: ReturnType<typeof createServerCaller>;
let textbookId: string;
let lessons: Record<string, string>;

const json = (value: unknown) => JSON.stringify(value);
const isoIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const HOMEWORK = { version: 1, title: "Finish int homework", tasks: [{ type: "single_choice", prompt: "Pick a.", options: ["a", "b"], answer: 0 }] };

async function codeOf(call: Promise<unknown>) {
  try {
    await call;
    return "OK";
  } catch (error) {
    return error instanceof TRPCError ? error.code : String(error);
  }
}

/** A student on the textbook with 1.1 passed, a homework draft and a lesson in two days, prepared: 1.2 with the draft. */
async function preparedLesson(firstName: string) {
  const { id: studentId } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  await teacher.teacher.prep.setStudentTextbook({ studentId, textbookId, passedLessonId: lessons["1.1"]! });
  const { id: homeworkId } = await teacher.teacher.homework.import({ studentId, json: json(HOMEWORK) });
  const { id: lessonId } = await teacher.teacher.schedule.addLesson({ studentId, date: isoIn(2), time: "10:00", durationMinutes: 45, intro: false });
  await teacher.teacher.prep.save({
    lessonId,
    plan: { stages: [{ type: "book", lessonId: lessons["1.2"]!, skip: "", minutes: 30 }] },
    homeworkId,
    revision: "",
  });
  await teacher.teacher.lessonMode.open({ lessonId });
  return { studentId, homeworkId, lessonId };
}

/** The form as the panel sends it, with these words. */
async function finishInput(lessonId: string, words: { word: string; translation: string }[]) {
  const form = await teacher.teacher.lessonMode.finishForm({ lessonId });
  return {
    lessonId,
    charged: form.charged,
    note: "A synthetic note",
    bookLessonId: form.bookLessonId,
    homework: form.homework ? { id: form.homework.id, revision: form.homework.revision, dueDate: form.homework.dueDate } : null,
    words,
  };
}

async function studentSession(studentId: string) {
  const token = (await teacher.teacher.links.student({ studentId })).url.split("#")[1]!;
  const response = await handleRouterRequest(
    new Request(`${env().APP_URL}/api/trpc/links.exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: json({ token }) }),
  );
  const cookie = response.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${LINK_SESSION_COOKIES.student}=`))!
    .split(";")[0]!;
  return createServerCaller(new Headers({ cookie }));
}

beforeAll(async () => {
  teacherHeaders = await signedInHeaders(teacherA);
  teacher = createServerCaller(teacherHeaders);
  other = createServerCaller(await signedInHeaders(teacherB));
  const response = await handleTextbookUpload(
    new Request(`${env().APP_URL}/api/files/textbooks?kind=book`, { method: "PUT", headers: teacherHeaders, body: new Uint8Array(pdf(6)) }),
  );
  const file = ((await response.json()) as { file: string }).file;
  ({ id: textbookId } = await teacher.teacher.textbooks.create({
    title: "Finish set",
    level: "A2",
    books: [{ kind: "students_book", name: "book.pdf", file }],
    tracks: [],
  }));
  for (let i = 0; i < 100 && (await teacher.teacher.textbooks.get({ id: textbookId })).books[0]!.status !== "done"; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const lesson = (title: string, from: number, words: string[]) => ({ title, pages: { students_book: { from, to: from + 1 } }, tracks: [], words });
  const { revision } = await teacher.teacher.textbooks.structure({ id: textbookId });
  await teacher.teacher.textbooks.saveStructure({
    id: textbookId,
    structure: { units: [{ title: "Unit 1", lessons: [lesson("1.1", 1, []), lesson("1.2", 3, ["lantern", "Pebble"]), lesson("1.3", 5, [])] }] },
    revision,
    confirm: true,
  });
  const structure = (await teacher.teacher.textbooks.structure({ id: textbookId })).structure!;
  lessons = Object.fromEntries(structure.units[0]!.lessons.map((l) => [l.title, l.id!]));
});

afterAll(closeDb);

describe("«Завершить урок»", () => {
  it("opens with the plan's book lesson, the homework and the next lesson's date", async () => {
    const { studentId, lessonId } = await preparedLesson("Форма урока");
    const { id: next } = await teacher.teacher.schedule.addLesson({ studentId, date: isoIn(9), time: "10:00", durationMinutes: 45, intro: false });
    const form = await teacher.teacher.lessonMode.finishForm({ lessonId });
    expect(form.bookLessonId).toBe(lessons["1.2"]);
    expect(form.charged).toBe(true);
    expect(form.homework).toMatchObject({ title: HOMEWORK.title, dueDate: isoIn(9) });
    await db().delete(lesson).where(eq(lesson.id, next));
    expect((await teacher.teacher.lessonMode.finishForm({ lessonId })).homework!.dueDate).toBe(isoIn(7));
  });

  it("holds the lesson, publishes the homework, moves the book on and merges the words; the assistant reads them, the student does not", async () => {
    const { studentId, homeworkId, lessonId } = await preparedLesson("Завершённый урок");
    const input = await finishInput(lessonId, [
      { word: "orange", translation: "апельсин" },
      { word: "LANTERN", translation: "фонарь" },
    ]);
    expect(await teacher.teacher.lessonMode.finish(input)).toEqual({ studentId });

    const [held] = await db().select().from(lesson).where(eq(lesson.id, lessonId));
    expect(held).toMatchObject({ status: "held", charged: true, unit: "Unit 1 · 1.2", note: "A synthetic note" });
    // Finished before its time: it moved to when it really started, and the history shows it.
    expect(held!.startsAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(held!.movedFrom).not.toBeNull();
    expect((await teacher.teacher.schedule.history({ studentId }))[0]).toMatchObject({ id: lessonId, status: "held" });

    const [published] = await db().select({ status: homework.status, dueDate: homework.dueDate }).from(homework).where(eq(homework.id, homeworkId));
    expect(published!.status).toBe("published");

    // The book lesson's words and the panel's, one row per word regardless of case; a missing translation filled in.
    const words = await teacher.teacher.students.vocabulary({ studentId });
    expect(words.map((w) => [w.word.toLowerCase(), w.translation]).sort()).toEqual([
      ["lantern", "фонарь"],
      ["orange", "апельсин"],
      ["pebble", null],
    ]);

    // The next preparation proposes 1.3.
    const { id: next } = await teacher.teacher.schedule.addLesson({ studentId, date: isoIn(5), time: "10:00", durationMinutes: 45, intro: false });
    expect((await teacher.teacher.prep.get({ lessonId: next })).proposed.stages[0]).toMatchObject({ type: "book", lessonId: lessons["1.3"] });

    // The assistant reads the vocabulary; the student's procedures never return it.
    const token = (await teacher.teacher.assistant.createToken()).token;
    const assistant = createServerCaller(new Headers({ authorization: `Bearer ${token}` }));
    const context = await assistant.agent.studentContext({ studentId });
    expect(context.vocabulary.map((w) => w.word.toLowerCase()).sort()).toEqual(["lantern", "orange", "pebble"]);
    const seen = JSON.stringify(await (await studentSession(studentId)).student.homework.current());
    for (const word of ["lantern", "orange", "pebble", "фонарь"]) expect(seen).not.toContain(word);

    // Finished once: a second time finds no lesson to finish.
    expect(await codeOf(teacher.teacher.lessonMode.finish(input))).toBe("NOT_FOUND");
  });

  it("«Учебник не проходили» adds no book words and leaves the passed lesson as it was", async () => {
    const { studentId, lessonId } = await preparedLesson("Без учебника");
    const input = { ...(await finishInput(lessonId, [{ word: "kettle", translation: "" }])), bookLessonId: null };
    await teacher.teacher.lessonMode.finish(input);
    expect((await teacher.teacher.students.vocabulary({ studentId })).map((w) => w.word)).toEqual(["kettle"]);
    const { id: next } = await teacher.teacher.schedule.addLesson({ studentId, date: isoIn(5), time: "10:00", durationMinutes: 45, intro: false });
    expect((await teacher.teacher.prep.get({ lessonId: next })).proposed.stages[0]).toMatchObject({ lessonId: lessons["1.2"] });
  });

  it("applies nothing when a step fails halfway", async () => {
    const { studentId, homeworkId, lessonId } = await preparedLesson("Сбой урока");
    const input = await finishInput(lessonId, [{ word: "fail-here", translation: "" }]);
    // The last step, the vocabulary, fails: everything before it must roll back.
    await db().execute(sql`
      create or replace function vocabulary_test_fail() returns trigger language plpgsql as $$
      begin if new.word = 'fail-here' then raise exception 'synthetic failure'; end if; return new; end $$`);
    await db().execute(sql`create trigger vocabulary_test_fail before insert on vocabulary_word for each row execute function vocabulary_test_fail()`);
    try {
      expect(await codeOf(teacher.teacher.lessonMode.finish(input))).toBe("INTERNAL_SERVER_ERROR");
    } finally {
      await db().execute(sql`drop trigger vocabulary_test_fail on vocabulary_word`);
      await db().execute(sql`drop function vocabulary_test_fail()`);
    }
    const [row] = await db().select({ status: lesson.status, note: lesson.note }).from(lesson).where(eq(lesson.id, lessonId));
    expect(row).toEqual({ status: "scheduled", note: null });
    const [draft] = await db().select({ status: homework.status }).from(homework).where(eq(homework.id, homeworkId));
    expect(draft!.status).toBe("draft");
    expect(await db().select().from(vocabularyWord).where(eq(vocabularyWord.studentId, studentId))).toEqual([]);
    const [kept] = await db().select({ passed: student.passedLessonId }).from(student).where(eq(student.id, studentId));
    expect(kept!.passed).toBe(lessons["1.1"]);
    // Nothing applied, so it can be done again.
    expect(await teacher.teacher.lessonMode.finish({ ...input, words: [] })).toEqual({ studentId });
  });

  it("refuses a homework changed since the form opened, and waits for a finish already holding the lesson", async () => {
    const { lessonId, homeworkId } = await preparedLesson("Гонка урока");
    const input = await finishInput(lessonId, []);
    await db().update(homework).set({ title: "Changed meanwhile" }).where(eq(homework.id, homeworkId));
    await db().execute(sql`update ${homework} set document = jsonb_set(document, '{title}', '"Changed meanwhile"') where id = ${homeworkId}`);
    expect(await codeOf(teacher.teacher.lessonMode.finish(input))).toBe("CONFLICT");

    // Another finish holds the lesson row: this one waits, then finds it held and applies nothing.
    const fresh = await finishInput(lessonId, [{ word: "late", translation: "" }]);
    let locked!: () => void;
    let release!: () => void;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    const holding = db().transaction(async (tx) => {
      await tx.select({ id: lesson.id }).from(lesson).where(eq(lesson.id, lessonId)).for("update");
      locked();
      await released;
      await tx.update(lesson).set({ status: "held" }).where(eq(lesson.id, lessonId));
    });
    await isLocked;
    const finishing = codeOf(teacher.teacher.lessonMode.finish(fresh));
    expect(await Promise.race([finishing, new Promise((resolve) => setTimeout(() => resolve("waiting"), 300))])).toBe("waiting");
    release();
    await holding;
    expect(await finishing).toBe("NOT_FOUND");
    const [draft] = await db().select({ status: homework.status }).from(homework).where(eq(homework.id, homeworkId));
    expect(draft!.status).toBe("draft");
  });

  it("another teacher's lesson answers like a missing one", async () => {
    const { lessonId } = await preparedLesson("Чужой урок");
    expect(await codeOf(other.teacher.lessonMode.finishForm({ lessonId }))).toBe("NOT_FOUND");
    expect(await codeOf(other.teacher.lessonMode.finish(await finishInput(lessonId, [])))).toBe("NOT_FOUND");
  });
});
