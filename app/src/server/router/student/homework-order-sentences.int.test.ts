import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sentences from "../../../../../deploy/seed/homework/demo-order-sentences.json";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { closeDb, db } from "../../db/client";
import { homeworkSubmission } from "../../db/schema";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest } from "../index";

// An order task of several sentences (#161): one task, a point per sentence.
// The student gets each sentence shuffled and no right order; the score, the
// review, the mistakes by topic and the assistant's context count each
// sentence; the teacher marks a sentence at a time. The homework is synthetic
// (deploy/seed/homework/demo-order-sentences.json): I like green apples / We
// go to school by bus / She is my best friend.

const [teacherA] = seedTeachers as [(typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;
let assistant: ReturnType<typeof createServerCaller>;

const json = (value: unknown) => JSON.stringify(value);
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const routerRequest = (path: string, init: RequestInit = {}) => handleRouterRequest(new Request(`${env().APP_URL}/api/trpc/${path}`, init));
const [first, second, third] = sentences.tasks[0]!.sentences.map((s) => s.words) as [string[], string[], string[]];
const twoRight = { type: "order" as const, sentences: [first, second, ["She", "is", "best", "my", "friend"]] };

async function studentWithSentences(firstName: string, document: unknown = sentences) {
  const { id: studentId } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  const token = (await teacher.teacher.links.student({ studentId })).url.split("#")[1]!;
  const response = await routerRequest("links.exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: json({ token }),
  });
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES.student}=`))!.split(";")[0]!;
  const { id } = await teacher.teacher.homework.import({ studentId, json: json(document) });
  const { revision } = await teacher.teacher.homework.get({ id });
  await teacher.teacher.homework.publish({ id, revision, dueDate: inDays(3) });
  return { id, studentId, cookie, student: createServerCaller(new Headers({ cookie })) };
}

async function submitted(firstName: string, answer: object = twoRight, document: unknown = sentences) {
  const found = await studentWithSentences(firstName, document);
  await found.student.student.homework.saveAnswer({ id: found.id, taskIndex: 0, answer: answer as typeof twoRight });
  await found.student.student.homework.submit({ id: found.id, idempotencyKey: crypto.randomUUID() });
  const submissionId = (await teacher.teacher.review.list({ studentId: found.studentId }))[0]!.submissionId!;
  return { ...found, submissionId };
}

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  assistant = createServerCaller(new Headers({ authorization: `Bearer ${(await teacher.teacher.assistant.createToken()).token}` }));
});

afterAll(closeDb);

describe("an order task of several sentences", () => {
  it("reaches the student as shuffled sentences, with no right order", async () => {
    const { id, cookie } = await studentWithSentences("Предложения по порядку");
    const opened = await (await routerRequest(`student.homework.open?input=${encodeURIComponent(json({ id }))}`, { headers: { cookie } })).json();
    const [task] = opened.result.data.tasks;
    expect(task.sentences).toHaveLength(3);
    expect(task).not.toHaveProperty("words");
    for (const words of [first, second, third]) expect(json(opened)).not.toContain(json(words));
  });

  it("takes only each sentence's own words", async () => {
    const { id, student } = await studentWithSentences("Чужие слова");
    for (const sentencesAnswer of [[["bus"], [], []], [["I"], []], [["I", "I"], [], []]]) {
      await expect(
        student.student.homework.saveAnswer({ id, taskIndex: 0, answer: { type: "order", sentences: sentencesAnswer } }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    await expect(student.student.homework.saveAnswer({ id, taskIndex: 0, answer: { type: "order", words: first } })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    // A part of the sentences is kept as it is.
    await student.student.homework.saveAnswer({ id, taskIndex: 0, answer: { type: "order", sentences: [["I"], [], []] } });
  });

  it("counts a point per sentence in the score, the review, the mistakes and the assistant's context", async () => {
    const { student, studentId, submissionId } = await submitted("Два из трёх");
    expect(await student.student.homework.current()).toMatchObject({ result: { correct: 2, wrong: 1, pending: 0 } });

    const review = await teacher.teacher.review.get({ id: submissionId });
    expect(review).toMatchObject({ correct: 2, wrong: 1, pending: 0, mistakesByTopic: [{ topic: "word order", count: 1 }] });
    expect(review.tasks[0]).toMatchObject({
      verdict: false,
      sentences: [
        { answer: first.join(" "), verdict: true, marked: null },
        { answer: second.join(" "), verdict: true, marked: null },
        { answer: "She is best my friend", key: third.join(" "), verdict: false, marked: null },
      ],
    });

    const context = await assistant.agent.studentContext({ studentId });
    expect(context.recentHomework[0]!.tasks[0]).toMatchObject({
      correct: false,
      markedByTeacher: false,
      sentences: [
        { correct: true, markedByTeacher: false },
        { correct: true, markedByTeacher: false },
        { answer: "She is best my friend", correct: false, markedByTeacher: false },
      ],
    });
    expect(context.mistakesByTopic).toEqual([{ topic: "word order", count: 1 }]);
    expect(json(context)).not.toContain(third.join(" "));
  });

  it("counts each of two wrong sentences in the review, the student's mistakes and the assistant's context (#204)", async () => {
    const twoWrong = { type: "order" as const, sentences: [first, [...second].reverse(), ["She", "is", "best", "my", "friend"]] };
    const { studentId, submissionId } = await submitted("Две ошибки в задании", twoWrong);
    const counts = async () => ({
      review: (await teacher.teacher.review.get({ id: submissionId })).mistakesByTopic,
      card: (await teacher.teacher.students.mistakes({ studentId })).map(({ topic, count, mistakes }) => ({ topic, count, listed: mistakes.length })),
      context: (await assistant.agent.studentContext({ studentId })).mistakesByTopic,
    });
    expect(await counts()).toEqual({
      review: [{ topic: "word order", count: 2 }],
      card: [{ topic: "word order", count: 2, listed: 2 }],
      context: [{ topic: "word order", count: 2 }],
    });
    // Each listed with the student's own answer for that sentence, never the key.
    const listed = (await teacher.teacher.students.mistakes({ studentId }))[0]!.mistakes.map((m) => m.answer);
    expect(listed.sort()).toEqual([[...second].reverse().join(" "), "She is best my friend"].sort());
    expect(json(listed)).not.toContain(third.join(" "));

    // The teacher's mark wins: one sentence marked right leaves one mistake everywhere.
    await teacher.teacher.review.mark({ id: submissionId, taskIndex: 0, sentence: 1, mark: true });
    expect(await counts()).toEqual({
      review: [{ topic: "word order", count: 1 }],
      card: [{ topic: "word order", count: 1, listed: 1 }],
      context: [{ topic: "word order", count: 1 }],
    });
  });

  it("is marked a sentence at a time, and nothing else", async () => {
    const { student, submissionId } = await submitted("Отметка по предложению");
    await teacher.teacher.review.mark({ id: submissionId, taskIndex: 0, sentence: 2, mark: true });
    expect(await teacher.teacher.review.get({ id: submissionId })).toMatchObject({ correct: 3, wrong: 0, mistakesByTopic: [] });
    await teacher.teacher.review.mark({ id: submissionId, taskIndex: 0, sentence: 0, mark: false });
    const review = await teacher.teacher.review.get({ id: submissionId });
    expect(review).toMatchObject({ correct: 2, wrong: 1 });
    expect(review.tasks[0]!.sentences!.map((s) => [s.verdict, s.marked])).toEqual([
      [false, false],
      [true, null],
      [true, true],
    ]);
    expect(await student.student.homework.current()).toMatchObject({ result: { correct: 2, wrong: 1 } });

    // The whole task, a sentence that is not there: the same as a missing task.
    for (const input of [{}, { sentence: 3 }]) {
      await expect(teacher.teacher.review.mark({ id: submissionId, taskIndex: 0, mark: true, ...input })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    }
  });

  it("refuses a sentence on a task of one point, which keeps one point", async () => {
    const one = { version: 1, title: "One", tasks: [{ type: "order", prompt: "p", words: ["a", "b"], topic: "word order" }] };
    const { student, submissionId } = await submitted("Одно предложение", { type: "order", words: ["b", "a"] }, one);
    expect(await student.student.homework.current()).toMatchObject({ result: { correct: 0, wrong: 1, pending: 0 } });
    await expect(teacher.teacher.review.mark({ id: submissionId, taskIndex: 0, sentence: 0, mark: true })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await teacher.teacher.review.mark({ id: submissionId, taskIndex: 0, mark: true });
    expect(await teacher.teacher.review.get({ id: submissionId })).toMatchObject({ correct: 1, wrong: 0 });
    expect((await teacher.teacher.review.get({ id: submissionId })).tasks[0]!.sentences).toBeNull();
  });

  it("serialises two marks of one submission on its row, so neither is lost", async () => {
    const { submissionId } = await submitted("Две отметки");
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let holding!: () => void;
    const isHolding = new Promise<void>((resolve) => (holding = resolve));
    const competing = db().transaction(async (tx) => {
      await tx.select().from(homeworkSubmission).where(eq(homeworkSubmission.id, submissionId)).for("update");
      holding();
      await held;
    });
    await isHolding;

    let settled = false;
    const marking = teacher.teacher.review.mark({ id: submissionId, taskIndex: 0, sentence: 2, mark: true }).finally(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(settled).toBe(false);
    release();
    await competing;
    await marking;
    await teacher.teacher.review.mark({ id: submissionId, taskIndex: 0, sentence: 1, mark: false });
    const [row] = await db()
      .select({ correct: homeworkSubmission.correctCount, wrong: homeworkSubmission.wrongCount })
      .from(homeworkSubmission)
      .where(eq(homeworkSubmission.id, submissionId));
    expect(row).toEqual({ correct: 2, wrong: 1 });
  });
});
