import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, MASTERED_STEP } from "../../../domain/word-training";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { answerExercise, applyAnswer, dueToday, readWord } from "../../crm/word-training";
import { closeDb, db } from "../../db/client";
import { student as studentTable, vocabularyWord } from "../../db/schema";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest } from "../index";

// The daily word training (#238): today's due words with a translation, one
// exercise each without its key; answers checked on the server, moving the
// word through the schedule in the student's time zone; «Ещё разок» moving
// nothing; another student's word not found. The words are synthetic.

const [teacherA] = seedTeachers as [(typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;

const WORDS = { teapot: "чайник", pebble: "камешек", ladder: "лестница", mitten: "варежка" };
// Noon in Moscow on the 20th, and on later days.
const day = (n: number) => new Date(Date.parse("2026-11-20T09:00:00Z") + n * 86_400_000);

async function newStudent(firstName: string, words: Record<string, string> = WORDS) {
  const { id: studentId } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  for (const [word, translation] of Object.entries(words)) await teacher.teacher.students.addWord({ studentId, word, translation, example: "" });
  const token = (await teacher.teacher.links.student({ studentId })).url.split("#")[1]!;
  const response = await handleRouterRequest(
    new Request(`${env().APP_URL}/api/trpc/links.exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }),
  );
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES.student}=`))!.split(";")[0]!;
  const ids = Object.fromEntries((await teacher.teacher.students.vocabulary({ studentId })).map((w) => [w.word, w.id]));
  const [{ teacherId }] = (await db().select({ teacherId: studentTable.teacherId }).from(studentTable).where(eq(studentTable.id, studentId))) as [{ teacherId: string }];
  return { studentId, teacherId, ids, student: createServerCaller(new Headers({ cookie })) };
}

const stateOf = async (id: string) =>
  (await db().select({ step: vocabularyWord.trainStep, dueOn: vocabularyWord.dueOn, right: vocabularyWord.rightCount, wrong: vocabularyWord.wrongCount }).from(vocabularyWord).where(eq(vocabularyWord.id, id)))[0]!;

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
});

afterAll(closeDb);

describe("the daily word training", () => {
  it("gives today's words with a translation, a new one as choosing its translation out of four, no word without a translation", async () => {
    const { studentId, student } = await newStudent("Сегодняшние слова", { ...WORDS, lantern: "" });
    const session = await student.student.vocabulary.training({ extra: false });
    expect(session.map((e) => e.prompt).sort()).toEqual(Object.keys(WORDS).sort());
    for (const exercise of session) {
      expect(exercise.type).toBe("choose_translation");
      expect(exercise.options).toHaveLength(4);
      expect(exercise.options).toContain(WORDS[exercise.prompt as keyof typeof WORDS]);
      expect(new Set(exercise.options).size).toBe(4);
    }
    expect(JSON.stringify(session)).not.toContain("lantern");
    expect(await student.student.vocabulary.dueToday()).toEqual({ count: 4 });
    expect((await teacher.teacher.students.vocabulary({ studentId })).length).toBe(5);
  });

  it("moves a word through 1, 2, 4, 8, 16 days and learns it; a wrong answer brings it back tomorrow from the start", async () => {
    const { studentId, teacherId, ids } = await newStudent("Расписание слова");
    const answer = (n: number, value: string, extra = false) =>
      answerExercise(db(), teacherId, studentId, { wordId: ids.teapot!, type: "choose_translation", answer: value, extra }, day(n));

    let n = 0;
    for (const gap of [1, 2, 4, 8, 16]) {
      expect(await answer(n, "чайник")).toEqual({ right: true, correct: "чайник" });
      expect((await stateOf(ids.teapot!)).dueOn).toBe(addDays("2026-11-20", n + gap));
      // Answered again the same day: due no longer, so it moves nothing.
      await answer(n, "чайник");
      expect((await stateOf(ids.teapot!)).dueOn).toBe(addDays("2026-11-20", n + gap));
      n += gap;
    }
    expect(await stateOf(ids.teapot!)).toMatchObject({ step: MASTERED_STEP, right: 10, wrong: 0 });
    expect(await dueToday(db(), teacherId, studentId, day(n - 1))).toBe(3);

    expect(await answer(n, "камешек")).toEqual({ right: false, correct: "чайник" });
    expect(await stateOf(ids.teapot!)).toMatchObject({ step: 0, dueOn: addDays("2026-11-20", n + 1), wrong: 1 });
  });

  it("«Ещё разок» moves nothing for a right answer; its mistake brings the word back tomorrow", async () => {
    const { studentId, teacherId, ids, student } = await newStudent("Ещё разок");
    await answerExercise(db(), teacherId, studentId, { wordId: ids.pebble!, type: "choose_translation", answer: "камешек", extra: false }, day(0));
    const after = await stateOf(ids.pebble!);

    expect((await student.student.vocabulary.training({ extra: true })).length).toBe(4);
    await answerExercise(db(), teacherId, studentId, { wordId: ids.pebble!, type: "choose_word", answer: "pebble", extra: true }, day(0));
    expect(await stateOf(ids.pebble!)).toMatchObject({ step: after.step, dueOn: after.dueOn });
    // Even when the word is due, an extra answer does not count.
    await answerExercise(db(), teacherId, studentId, { wordId: ids.ladder!, type: "choose_translation", answer: "лестница", extra: true }, day(0));
    expect(await stateOf(ids.ladder!)).toMatchObject({ step: 0, dueOn: null });
    await answerExercise(db(), teacherId, studentId, { wordId: ids.pebble!, type: "type_word", answer: "pebbles", extra: true }, day(0));
    expect(await stateOf(ids.pebble!)).toMatchObject({ step: 0, dueOn: addDays("2026-11-20", 1) });
  });

  it("checks a typed word ignoring case and spaces; another student's word is not found", async () => {
    const mine = await newStudent("Печатает слово");
    const theirs = await newStudent("Чужое слово");
    expect(await mine.student.student.vocabulary.answer({ wordId: mine.ids.mitten!, type: "type_word", answer: "  Mitten ", extra: true })).toEqual({
      right: true,
      correct: "mitten",
    });
    await expect(mine.student.student.vocabulary.answer({ wordId: theirs.ids.mitten!, type: "type_word", answer: "mitten", extra: false })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await stateOf(theirs.ids.mitten!)).toMatchObject({ step: 0, dueOn: null, right: 0, wrong: 0 });
  });

  it("checks an answer again when another one moved the word after it was read", async () => {
    const { studentId, teacherId, ids } = await newStudent("Две вкладки");
    const answer = { wordId: ids.ladder!, type: "choose_translation" as const, answer: "лестница", extra: false };
    // One tab reads the word.
    const seen = (await readWord(db(), teacherId, studentId, ids.ladder!))!;
    // The other tab answers it first and moves it on.
    expect(await applyAnswer(db(), teacherId, studentId, answer, seen, "2026-11-20", day(0))).toEqual({ right: true, correct: "лестница" });
    // The first tab's write, against what it read, is refused: the word is not moved twice.
    expect(await applyAnswer(db(), teacherId, studentId, answer, seen, "2026-11-20", day(0))).toBe("changed");
    expect(await stateOf(ids.ladder!)).toMatchObject({ step: 1, dueOn: "2026-11-21", right: 1 });
    // Checked again from the start, it counts as not due and moves nothing.
    await answerExercise(db(), teacherId, studentId, answer, day(0));
    expect(await stateOf(ids.ladder!)).toMatchObject({ step: 1, dueOn: "2026-11-21", right: 2 });
  });
});
