import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayIn } from "../../domain/homework";
import type { Task } from "../../domain/homework-format";
import { addDays } from "../../domain/word-training";
import { vocabularyTasks } from "../../domain/vocabulary-homework";
import { LINK_SESSION_COOKIES } from "../access/links";
import { closeDb, db } from "../db/client";
import { vocabularyWord } from "../db/schema";
import { env } from "../env";
import { createServerCaller, handleRouterRequest } from "../router/index";
import { seedTeachers, signedInHeaders } from "../testing/requests";

// A mistake on a word in a homework task from «Из словаря» (#284): on
// submission the word counts a mistake, starts again and is due tomorrow in
// the student's time zone, unless it is due by then already; a right answer
// moves nothing. A matching task counts each word by its pair. An edited
// task keeps its words only while its answer is still the word or its
// translation; a word deleted from the vocabulary changes nothing. The
// words are synthetic.

const [teacherA] = seedTeachers as [(typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;

const MOSCOW = "Europe/Moscow";
const today = () => todayIn(MOSCOW);
const WORDS: [string, string][] = [
  ["owl", "сова"],
  ["fox", "лиса"],
  ["elk", "лось"],
  ["bee", "пчела"],
];

async function studentWithWords(firstName: string) {
  const { id: studentId } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: MOSCOW });
  for (const [word, translation] of WORDS) await teacher.teacher.students.addWord({ studentId, word, translation, example: "" });
  const { url } = await teacher.teacher.links.student({ studentId });
  const response = await handleRouterRequest(
    new Request(`${env().APP_URL}/api/trpc/links.exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: url.split("#")[1]! }) }),
  );
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES.student}=`))!.split(";")[0]!;
  return { studentId, student: createServerCaller(new Headers({ cookie })) };
}

/** A draft of the given tasks, as «Из словаря» builds them from all the student's words, saved through the editor and published. */
async function published(studentId: string, build: (pool: { id: string; word: string; translation: string }[]) => Task[]) {
  const { id } = await teacher.teacher.homework.import({ studentId, json: JSON.stringify({ version: 1, title: "Слова", tasks: [{ type: "written", prompt: "x" }] }) });
  const pool = (await teacher.teacher.homework.vocabulary({ id })).map(({ id: wordId, word, translation }) => ({ id: wordId, word, translation }));
  const { revision } = await teacher.teacher.homework.get({ id });
  const saved = await teacher.teacher.homework.updateTasks({ id, revision, tasks: build(pool) });
  await teacher.teacher.homework.publish({ id, revision: saved.revision, dueDate: addDays(today(), 3) });
  return { id, tasks: saved.tasks, pool };
}

async function state(studentId: string) {
  const rows = await db()
    .select({ word: vocabularyWord.word, step: vocabularyWord.trainStep, dueOn: vocabularyWord.dueOn, wrong: vocabularyWord.wrongCount })
    .from(vocabularyWord)
    .where(eq(vocabularyWord.studentId, studentId));
  return Object.fromEntries(rows.map(({ word, ...rest }) => [word, rest]));
}

const setWord = (studentId: string, word: string, values: Partial<typeof vocabularyWord.$inferInsert>) =>
  db().update(vocabularyWord).set(values).where(and(eq(vocabularyWord.studentId, studentId), eq(vocabularyWord.word, word)));

/** The index of the option that is not the task's key. */
const wrongChoice = (task: Task) => (task.type === "single_choice" ? (task.answer + 1) % task.options.length : 0);

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
});

afterAll(closeDb);

describe("a mistake on a word in homework from the vocabulary", () => {
  it("brings the word back tomorrow from the start; a right answer and a word due earlier stay as they are", async () => {
    const { studentId, student } = await studentWithWords("Ошибки слова");
    await setWord(studentId, "owl", { trainStep: 3, dueOn: addDays(today(), 8), trainedAt: new Date(), rightCount: 3 });
    await setWord(studentId, "fox", { trainStep: 2, dueOn: today(), trainedAt: new Date(), rightCount: 2 });
    await setWord(studentId, "elk", { trainStep: 4, dueOn: addDays(today(), 16), trainedAt: new Date(), rightCount: 4 });
    const { id, tasks } = await published(studentId, (pool) => vocabularyTasks(pool, pool, ["choose_translation"]));
    // owl and fox wrong, elk right, bee (new) wrong.
    for (const [index, task] of tasks.entries()) {
      const word = task.prompt.match(/«(.+)»/)![1]!;
      const choice = word === "elk" && task.type === "single_choice" ? task.answer : wrongChoice(task);
      await student.student.homework.saveAnswer({ id, taskIndex: index, answer: { type: "single_choice", choice } });
    }
    await student.student.homework.submit({ id, idempotencyKey: crypto.randomUUID() });

    expect(await state(studentId)).toEqual({
      owl: { step: 0, dueOn: addDays(today(), 1), wrong: 1 },
      // Due today already: not pushed to tomorrow.
      fox: { step: 0, dueOn: today(), wrong: 1 },
      elk: { step: 4, dueOn: addDays(today(), 16), wrong: 0 },
      // New, due now: stays due now.
      bee: { step: 0, dueOn: null, wrong: 1 },
    });
    // Marked «часто ошибается» on the card, the untrained word too.
    const marks = Object.fromEntries((await teacher.teacher.students.vocabulary({ studentId })).map((w) => [w.word, w.mark]));
    expect(marks).toMatchObject({ bee: "often_wrong", elk: "learning" });
  });

  it("counts in a matching task only the words of its wrong pairs; no answer misses them all", async () => {
    const { studentId, student } = await studentWithWords("Ошибки пары");
    const { id, tasks } = await published(studentId, (pool) => [...vocabularyTasks(pool.slice(0, 2), pool, ["match"]), ...vocabularyTasks(pool.slice(2), pool, ["match"])]);
    const [first] = tasks;
    if (first?.type !== "match") throw new Error("not a match");
    const [a, b] = first.pairs;
    // The two pairs of the first task swapped: both its words wrong. The second task is left unanswered.
    await student.student.homework.saveAnswer({
      id,
      taskIndex: 0,
      answer: { type: "match", pairs: [{ left: a!.left as string, right: b!.right }, { left: b!.left as string, right: a!.right }] },
    });
    await student.student.homework.submit({ id, idempotencyKey: crypto.randomUUID() });
    expect(Object.values(await state(studentId)).map((w) => w.wrong)).toEqual([1, 1, 1, 1]);

    const other = await studentWithWords("Ошибки одна пара");
    const second = await published(other.studentId, (pool) => vocabularyTasks(pool, pool, ["match"]));
    const task = second.tasks[0];
    if (task?.type !== "match") throw new Error("not a match");
    const pairs = task.pairs.map((p) => ({ left: p.left as string, right: p.right }));
    // Only owl's and fox's pairs swapped.
    const owl = pairs.findIndex((p) => p.left === "owl");
    const fox = pairs.findIndex((p) => p.left === "fox");
    [pairs[owl]!.right, pairs[fox]!.right] = [pairs[fox]!.right, pairs[owl]!.right];
    await other.student.student.homework.saveAnswer({ id: second.id, taskIndex: 0, answer: { type: "match", pairs } });
    await other.student.student.homework.submit({ id: second.id, idempotencyKey: crypto.randomUUID() });
    const after = await state(other.studentId);
    expect([after.owl!.wrong, after.fox!.wrong, after.elk!.wrong, after.bee!.wrong]).toEqual([1, 1, 0, 0]);
  });

  it("keeps an edited task's words while its answer is the word or its translation; a deleted word changes nothing", async () => {
    const { studentId, student } = await studentWithWords("Ошибки правка");
    const { id, tasks, pool } = await published(studentId, (words) => vocabularyTasks(words.slice(0, 2), words, ["type_word"]));
    expect(tasks.map((t) => t.vocabularyWords)).toEqual([[pool[0]!.id], [pool[1]!.id]]);
    await teacher.teacher.homework.unpublish({ id });
    const { revision } = await teacher.teacher.homework.get({ id });
    // The first task's prompt reworded, the key still the word; the second task's key changed to another word.
    const edited = [
      { ...tasks[0]!, prompt: "Переведи на английский" },
      { ...tasks[1]!, answers: [["something else"]] },
    ] as Task[];
    const saved = await teacher.teacher.homework.updateTasks({ id, revision, tasks: edited });
    expect(saved.tasks.map((t) => t.vocabularyWords)).toEqual([[pool[0]!.id], undefined]);

    // The first word deleted from the vocabulary since: its mistake changes nothing.
    await teacher.teacher.students.deleteWord({ studentId, id: pool[0]!.id });
    await teacher.teacher.homework.publish({ id, revision: saved.revision, dueDate: addDays(today(), 3) });
    for (const taskIndex of [0, 1]) await student.student.homework.saveAnswer({ id, taskIndex, answer: { type: "gap", gaps: ["wrong"] } });
    await student.student.homework.submit({ id, idempotencyKey: crypto.randomUUID() });
    expect(Object.values(await state(studentId)).every((w) => w.wrong === 0)).toBe(true);
  });
});
