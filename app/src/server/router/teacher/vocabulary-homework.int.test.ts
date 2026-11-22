import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PICKED_WORDS, vocabularyTasks } from "../../../domain/vocabulary-homework";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { closeDb, db } from "../../db/client";
import { lesson, student, vocabularyWord } from "../../db/schema";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest } from "../index";

// «Из словаря» in a homework draft (#281): the student's words with a
// confirmed translation, the last lesson's and the weak ones ticked, at most
// 12; the tasks built from them name their words, kept on save only when
// they are this student's; the student never receives them. The teacher's
// only. The words are synthetic.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;
let other: ReturnType<typeof createServerCaller>;

const draft = { version: 1, title: "Из словаря", tasks: [{ type: "written", prompt: "x" }] };
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function newStudent(firstName: string) {
  const { id } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  const [row] = await db().select({ teacherId: student.teacherId }).from(student).where(eq(student.id, id));
  return { studentId: id, teacherId: row!.teacherId };
}

async function words(studentId: string, list: [string, string][]) {
  for (const [word, translation] of list) await teacher.teacher.students.addWord({ studentId, word, translation, example: "" });
  const rows = await db().select({ id: vocabularyWord.id, word: vocabularyWord.word }).from(vocabularyWord).where(eq(vocabularyWord.studentId, studentId));
  return Object.fromEntries(rows.map((r) => [r.word, r.id]));
}

async function lessonAt(teacherId: string, studentId: string, daysAgo: number) {
  const [row] = await db()
    .insert(lesson)
    .values({ teacherId, studentId, startsAt: new Date(Date.now() - daysAgo * 86_400_000), durationMinutes: 60, status: "held" })
    .returning({ id: lesson.id });
  return row!.id;
}

async function studentCaller(studentId: string) {
  const { url } = await teacher.teacher.links.student({ studentId });
  const response = await handleRouterRequest(
    new Request(`${env().APP_URL}/api/trpc/links.exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: url.split("#")[1]! }) }),
  );
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES.student}=`))!.split(";")[0]!;
  return createServerCaller(new Headers({ cookie }));
}

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  other = createServerCaller(await signedInHeaders(teacherB));
});

afterAll(closeDb);

describe("«Из словаря» in a homework draft", () => {
  it("offers the words with a translation, the last lesson's and the weak ones ticked, at most 12", async () => {
    const { studentId, teacherId } = await newStudent("Словарь отметки");
    const ids = await words(studentId, [
      ["owl", "сова"],
      ["fox", "лиса"],
      ["elk", "лось"],
      ["bee", "пчела"],
      ["ant", ""],
    ]);
    const earlier = await lessonAt(teacherId, studentId, 9);
    const last = await lessonAt(teacherId, studentId, 2);
    const set = (word: string, values: Partial<typeof vocabularyWord.$inferInsert>) =>
      db().update(vocabularyWord).set(values).where(and(eq(vocabularyWord.studentId, studentId), eq(vocabularyWord.word, word)));
    await set("owl", { lessonId: last });
    await set("fox", { lessonId: earlier });
    // Wrong more often than right in the training: «часто ошибается».
    await set("elk", { trainedAt: new Date(), rightCount: 1, wrongCount: 3 });
    const { id } = await teacher.teacher.homework.import({ studentId, json: JSON.stringify(draft) });

    const offered = await teacher.teacher.homework.vocabulary({ id });
    expect(offered.map((w) => w.word).sort()).toEqual(["bee", "elk", "fox", "owl"]);
    expect(offered.filter((w) => w.ticked).map((w) => w.word).sort()).toEqual(["elk", "owl"]);
    expect(offered.find((w) => w.word === "owl")).toEqual({ id: ids.owl, word: "owl", translation: "сова", ticked: true });

    // Many words of the last lesson: only the first 12 are ticked.
    const many = await words(studentId, Array.from({ length: 14 }, (_, i) => [`word${i}`, `слово${i}`] as [string, string]));
    for (const wordId of Object.values(many)) await db().update(vocabularyWord).set({ lessonId: last }).where(eq(vocabularyWord.id, wordId));
    expect((await teacher.teacher.homework.vocabulary({ id })).filter((w) => w.ticked)).toHaveLength(PICKED_WORDS);
  });

  it("keeps on save the words of this student only, and the student never receives them", async () => {
    const { studentId } = await newStudent("Словарь связь");
    const ids = await words(studentId, [
      ["owl", "сова"],
      ["fox", "лиса"],
      ["elk", "лось"],
      ["bee", "пчела"],
    ]);
    const { studentId: stranger } = await newStudent("Словарь чужой");
    const theirs = await words(stranger, [["cat", "кошка"]]);
    const { id } = await teacher.teacher.homework.import({ studentId, json: JSON.stringify(draft) });
    const pool = (await teacher.teacher.homework.vocabulary({ id })).map(({ id: wordId, word, translation }) => ({ id: wordId, word, translation }));
    const built = vocabularyTasks(pool, pool, ["match", "choose_translation"]);
    // Another student's word slipped into a task is dropped; the task stays.
    const forged = { ...built[1]!, words: [...built[1]!.words!, theirs.cat!] };
    const { revision } = await teacher.teacher.homework.get({ id });
    const saved = await teacher.teacher.homework.updateTasks({ id, revision, tasks: [draft.tasks[0], built[0], forged, ...built.slice(2)] });
    expect(saved.tasks).toHaveLength(1 + built.length);
    expect(saved.tasks[1]!.words!.sort()).toEqual(Object.values(ids).sort());
    expect(saved.tasks[2]!.words).toEqual(built[1]!.words);

    await teacher.teacher.homework.publish({ id, revision: saved.revision, dueDate: inDays(3) });
    const opened = await (await studentCaller(studentId)).student.homework.open({ id });
    expect(JSON.stringify(opened)).not.toMatch(/words|[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("is the teacher's own: another teacher, and a published homework, get not found", async () => {
    const { studentId } = await newStudent("Словарь доступ");
    await words(studentId, [["owl", "сова"]]);
    const { id } = await teacher.teacher.homework.import({ studentId, json: JSON.stringify(draft) });
    await expect(other.teacher.homework.vocabulary({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { revision } = await teacher.teacher.homework.get({ id });
    await teacher.teacher.homework.publish({ id, revision, dueDate: inDays(3) });
    await expect(teacher.teacher.homework.vocabulary({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
