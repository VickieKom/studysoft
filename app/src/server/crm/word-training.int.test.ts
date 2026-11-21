import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GAP_STEP } from "../../domain/word-training";
import { LINK_SESSION_COOKIES } from "../access/links";
import { closeDb, db } from "../db/client";
import { vocabularyWord } from "../db/schema";
import { env } from "../env";
import { createServerCaller, handleRouterRequest } from "../router/index";
import { seedTeachers, signedInHeaders } from "../testing/requests";

// «Вставь слово в предложение» in the daily word training (#239): a word whose
// confirmed example uses it comes as that example with the word as a gap at
// the third right answer in a row, and always in «Ещё разок»; a word without
// an example, with only the assistant's unconfirmed one, or with one that
// does not use it as it is never does. The gap is answered with the word and
// the sentence shown whole; the exercise never carries the word itself. The
// words are synthetic.

const [teacherA] = seedTeachers as [(typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;

const WORDS: Record<string, { translation: string; example: string }> = {
  teapot: { translation: "чайник", example: "The teapot is hot." },
  pebble: { translation: "камешек", example: "" },
  ladder: { translation: "лестница", example: "She went up the stairs." },
  mitten: { translation: "варежка", example: "" },
};

async function newStudent(firstName: string) {
  const { id: studentId } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  for (const [word, { translation, example }] of Object.entries(WORDS)) await teacher.teacher.students.addWord({ studentId, word, translation, example });
  const token = (await teacher.teacher.links.student({ studentId })).url.split("#")[1]!;
  const response = await handleRouterRequest(
    new Request(`${env().APP_URL}/api/trpc/links.exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }),
  );
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES.student}=`))!.split(";")[0]!;
  const ids = Object.fromEntries((await teacher.teacher.students.vocabulary({ studentId })).map((w) => [w.word, w.id]));
  return { ids, student: createServerCaller(new Headers({ cookie })) };
}

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
});

afterAll(closeDb);

describe("«Вставь слово в предложение»", () => {
  it("comes at step 2 only for a word whose confirmed example uses it, out of four words, without the word", async () => {
    const { ids, student } = await newStudent("Пропуск по шагу");
    // The assistant's example is a draft until the teacher confirms it: no gap from it.
    await db().update(vocabularyWord).set({ draftExample: "A mitten keeps a hand warm." }).where(eq(vocabularyWord.id, ids.mitten!));
    // Every word at the third right answer in a row, due today.
    await db().update(vocabularyWord).set({ trainStep: GAP_STEP }).where(eq(vocabularyWord.studentId, await studentOf(ids.teapot!)));
    const session = await student.student.vocabulary.training({ extra: false });
    const byWord = Object.fromEntries(Object.entries(ids).map(([word, id]) => [word, session.find((e) => e.wordId === id)!]));
    expect(byWord.teapot).toMatchObject({ type: "fill_gap", prompt: "The ___ is hot." });
    expect(byWord.teapot!.options).toHaveLength(4);
    expect(byWord.teapot!.options).toContain("teapot");
    // Without an example, with one that does not use the word, or only a draft one: the usual exercise of step 2.
    for (const word of ["pebble", "ladder", "mitten"]) expect(byWord[word]!.type).toBe("type_word");
    expect(JSON.stringify(session.filter((e) => e.type === "fill_gap").map((e) => e.prompt))).not.toContain("teapot");
  });

  it("comes in «Ещё разок» whatever the step, and only for that word", async () => {
    const { ids, student } = await newStudent("Пропуск ещё разок");
    const session = await student.student.vocabulary.training({ extra: true });
    expect(session.filter((e) => e.type === "fill_gap").map((e) => e.wordId)).toEqual([ids.teapot]);
    // Today's training of new words starts with the translation, the word with an example too.
    const today = await student.student.vocabulary.training({ extra: false });
    expect(today.every((e) => e.type === "choose_translation")).toBe(true);
  });

  it("is checked against the word and shows the sentence whole", async () => {
    const { ids, student } = await newStudent("Пропуск проверка");
    const wordId = ids.teapot!;
    expect(await student.student.vocabulary.answer({ wordId, type: "fill_gap", answer: "pebble", extra: true })).toEqual({ right: false, correct: "The teapot is hot." });
    expect(await student.student.vocabulary.answer({ wordId, type: "fill_gap", answer: " Teapot ", extra: true })).toEqual({ right: true, correct: "The teapot is hot." });
    // A gap claimed for a word that has none is checked against the word, and shows the word.
    expect(await student.student.vocabulary.answer({ wordId: ids.ladder!, type: "fill_gap", answer: "ladder", extra: true })).toEqual({ right: true, correct: "ladder" });
  });
});

async function studentOf(wordId: string): Promise<string> {
  const [row] = await db().select({ studentId: vocabularyWord.studentId }).from(vocabularyWord).where(eq(vocabularyWord.id, wordId));
  return row!.studentId;
}
