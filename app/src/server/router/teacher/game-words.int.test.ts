import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { closeDb, db } from "../../db/client";
import { lesson, libraryMaterial, student } from "../../db/schema";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest } from "../index";

// A game template gets a student's words (#282): a game marked «Со словами
// словаря» gets the words with a confirmed translation, with the confirmed
// example, of the student the teacher picks, of the lesson's student on the
// stage, or of the student behind the link for a game open to them. A game
// without the mark, another teacher's student or lesson, a game not open to
// the student: not found. The assistant saves a template as a draft. The
// games and words are synthetic.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;
let other: ReturnType<typeof createServerCaller>;
let assistant: ReturnType<typeof createServerCaller>;
let teacherId: string;

const html = (title: string) => `<!doctype html><html><body><h1>${title}</h1></body></html>`;
const tags = (title: string) => ({ title, level: "A2" as const, topic: "words", ageGroup: "younger" as const });

async function newStudent(firstName: string, as = teacher) {
  return (await as.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" })).id;
}

async function studentCaller(studentId: string) {
  const { url } = await teacher.teacher.links.student({ studentId });
  const response = await handleRouterRequest(
    new Request(`${env().APP_URL}/api/trpc/links.exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: url.split("#")[1]! }) }),
  );
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES.student}=`))!.split(";")[0]!;
  return createServerCaller(new Headers({ cookie }));
}

async function lessonNow(studentId: string) {
  const [row] = await db()
    .insert(lesson)
    .values({ teacherId, studentId, startsAt: new Date(Date.now() - 10 * 60_000), durationMinutes: 60, status: "scheduled" })
    .returning({ id: lesson.id });
  return row!.id;
}

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  other = createServerCaller(await signedInHeaders(teacherB));
  assistant = createServerCaller(new Headers({ authorization: `Bearer ${(await teacher.teacher.assistant.createToken()).token}` }));
  const [row] = await db().select({ teacherId: student.teacherId }).from(student).where(eq(student.id, await newStudent("Слова учитель")));
  teacherId = row!.teacherId;
});

afterAll(closeDb);

describe("a game template's words", () => {
  it("are the picked student's words with a translation, for a marked game only", async () => {
    const studentId = await newStudent("Слова шаблон");
    await teacher.teacher.students.addWord({ studentId, word: "teapot", translation: "чайник", example: "The teapot is hot." });
    await teacher.teacher.students.addWord({ studentId, word: "pebble", translation: "камешек", example: "" });
    await teacher.teacher.students.addWord({ studentId, word: "owl", translation: "", example: "" });
    const template = (await teacher.teacher.library.addGame({ ...tags("Шаблон"), html: html("Шаблон"), vocabulary: true })).id;
    const plain = (await teacher.teacher.library.addGame({ ...tags("Обычная"), html: html("Обычная") })).id;

    const { words } = await teacher.teacher.library.words({ id: template, studentId });
    expect([...words].sort((a, b) => a.word.localeCompare(b.word))).toEqual([
      { word: "pebble", translation: "камешек" },
      { word: "teapot", translation: "чайник", example: "The teapot is hot." },
    ]);
    expect((await teacher.teacher.library.get({ id: template })).vocabulary).toBe(true);
    await expect(teacher.teacher.library.words({ id: plain, studentId })).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Marked later in «Изменить», the plain game gets them too; unmarked again, it does not.
    await teacher.teacher.library.update({ id: plain, ...tags("Обычная"), vocabulary: true });
    expect((await teacher.teacher.library.words({ id: plain, studentId })).words).toHaveLength(2);
    await teacher.teacher.library.update({ id: plain, ...tags("Обычная"), vocabulary: false });
    await expect(teacher.teacher.library.words({ id: plain, studentId })).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Another teacher's student, or another teacher asking: not found.
    const theirs = await newStudent("Слова чужой", other);
    await expect(teacher.teacher.library.words({ id: template, studentId: theirs })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.teacher.library.words({ id: template, studentId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("go to the lesson's student on the stage and to the student behind the link for a game open to them", async () => {
    const studentId = await newStudent("Слова урок");
    const neighbour = await newStudent("Слова сосед");
    await teacher.teacher.students.addWord({ studentId, word: "ladder", translation: "лестница", example: "" });
    await teacher.teacher.students.addWord({ studentId: neighbour, word: "mitten", translation: "варежка", example: "" });
    const template = (await teacher.teacher.library.addGame({ ...tags("Шаблон урока"), html: html("Шаблон урока"), vocabulary: true })).id;
    const plain = (await teacher.teacher.library.addGame({ ...tags("Обычная урока"), html: html("Обычная урока") })).id;
    const lessonId = await lessonNow(studentId);
    await lessonNow(neighbour);

    expect((await teacher.teacher.lessonMode.gameWords({ lessonId, materialId: template })).words).toEqual([{ word: "ladder", translation: "лестница" }]);
    await expect(teacher.teacher.lessonMode.gameWords({ lessonId, materialId: plain })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.teacher.lessonMode.gameWords({ lessonId, materialId: template })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const pupil = await studentCaller(studentId);
    // Not open to them yet: the same not found as a missing game.
    await expect(pupil.student.games.words({ id: template })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await teacher.teacher.library.openToStudent({ id: template, studentId });
    await teacher.teacher.library.openToStudent({ id: plain, studentId });
    expect(await pupil.student.games.get({ id: template })).toMatchObject({ withWords: true });
    expect(await pupil.student.games.get({ id: plain })).toMatchObject({ withWords: false });
    expect((await pupil.student.games.words({ id: template })).words).toEqual([{ word: "ladder", translation: "лестница" }]);
    await expect(pupil.student.games.words({ id: plain })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // The neighbour, in a lesson too, gets nothing of a game not open to them.
    await expect((await studentCaller(neighbour)).student.games.words({ id: template })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is a draft the assistant saves with the mark", async () => {
    const { id } = await assistant.agent.saveGameDraft({ ...tags("Шаблон ассистента"), html: html("Шаблон ассистента"), vocabulary: true });
    const [row] = await db().select({ vocabulary: libraryMaterial.vocabulary, draft: libraryMaterial.draft }).from(libraryMaterial).where(eq(libraryMaterial.id, id));
    expect(row).toEqual({ vocabulary: true, draft: true });
    expect((await assistant.agent.gameWordsFormat()).version).toBe(1);
  });
});
