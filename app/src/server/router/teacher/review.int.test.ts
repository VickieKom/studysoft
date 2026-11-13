import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import review from "../../../../../deploy/seed/homework/demo-review.json";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { closeDb, db } from "../../db/client";
import { homeworkAnswer, homeworkSubmission, student } from "../../db/schema";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest } from "../index";

// «Проверка домашек» (#36). The synthetic homework: sky (colours), gap «is»
// (to be), animals cat + dog, and a written task the teacher checks.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];

let teacher: ReturnType<typeof createServerCaller>;
let otherTeacher: ReturnType<typeof createServerCaller>;

const json = (value: unknown) => JSON.stringify(value);
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function submitted(firstName: string, gap = "are", animals = [0]) {
  const { id: studentId } = await teacher.teacher.students.create({
    firstName,
    lastName: "",
    level: "A2",
    timeZone: "Europe/Moscow",
  });
  const token = (await teacher.teacher.links.student({ studentId })).url.split("#")[1]!;
  const response = await handleRouterRequest(
    new Request(`${env().APP_URL}/api/trpc/links.exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: json({ token }),
    }),
  );
  const cookie = response.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${LINK_SESSION_COOKIES.student}=`))!
    .split(";")[0]!;
  const student = createServerCaller(new Headers({ cookie }));
  const { id: homeworkId } = await teacher.teacher.homework.import({ studentId, json: json(review) });
  await teacher.teacher.homework.publish({ id: homeworkId, dueDate: inDays(3) });
  await answerAndSubmit(student, homeworkId, gap, animals);
  const row = (await teacher.teacher.review.list({ studentId }))[0]!;
  return { studentId, homeworkId, student, submissionId: row.submissionId! };
}

async function answerAndSubmit(
  student: ReturnType<typeof createServerCaller>,
  id: string,
  gap: string,
  animals: number[],
) {
  await student.student.homework.saveAnswer({ id, taskIndex: 0, answer: { type: "single_choice", choice: 0 } });
  await student.student.homework.saveAnswer({ id, taskIndex: 1, answer: { type: "gap", gaps: [gap] } });
  await student.student.homework.saveAnswer({ id, taskIndex: 2, answer: { type: "multiple_choice", choices: animals } });
  return student.student.homework.submit({ id, idempotencyKey: crypto.randomUUID() });
}

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  otherTeacher = createServerCaller(await signedInHeaders(teacherB));
});

afterAll(closeDb);

describe("teacher.review", () => {
  it("lists a submission as waiting and shows every answer, the keys of mistakes and mistakes by topic", async () => {
    const before = await teacher.teacher.review.waiting();
    const { studentId, submissionId } = await submitted("Список");
    expect(await teacher.teacher.review.waiting()).toBe(before + 1);

    const [row] = await teacher.teacher.review.list({ studentId });
    expect(row).toMatchObject({ studentName: "Список", correct: 1, wrong: 2, pending: 1, waiting: true, missed: false });

    const submission = await teacher.teacher.review.get({ id: submissionId });
    expect(submission.tasks.map((t) => [t.answer, t.verdict])).toEqual([
      ["blue", true],
      ["are", false],
      ["cat", false],
      [null, null],
    ]);
    expect(submission.tasks[1]!.key).toBe("is");
    expect(submission.mistakesByTopic).toEqual([
      { topic: "to be", count: 1 },
      { topic: "animals", count: 1 },
    ]);

    // Opened, but the written task is unmarked: still waiting.
    await teacher.teacher.review.opened({ id: submissionId });
    expect(await teacher.teacher.review.waiting()).toBe(before + 1);
  });

  it("recounts the score from the teacher's marks and stops waiting once every open task is marked", async () => {
    const { submissionId, student } = await submitted("Оценки");
    await teacher.teacher.review.opened({ id: submissionId });
    const before = await teacher.teacher.review.waiting();

    await teacher.teacher.review.mark({ id: submissionId, taskIndex: 1, mark: true });
    expect(await teacher.teacher.review.get({ id: submissionId })).toMatchObject({ correct: 2, wrong: 1, pending: 1 });
    await teacher.teacher.review.mark({ id: submissionId, taskIndex: 3, mark: false });
    expect(await teacher.teacher.review.get({ id: submissionId })).toMatchObject({ correct: 2, wrong: 2, pending: 0 });
    expect(await teacher.teacher.review.waiting()).toBe(before - 1);
    // The student's result follows the marks.
    expect(await student.student.homework.current()).toMatchObject({ result: { correct: 2, wrong: 2 } });

    await teacher.teacher.review.comment({ id: submissionId, comment: "Повтори to be." });
    expect((await teacher.teacher.review.get({ id: submissionId })).comment).toBe("Повтори to be.");
  });

  it("reopens for a blank attempt and keeps the first one as it was", async () => {
    const { homeworkId, submissionId, student } = await submitted("Заново");
    await teacher.teacher.review.mark({ id: submissionId, taskIndex: 3, mark: true });
    await teacher.teacher.review.reopen({ id: submissionId });

    const current = await student.student.homework.current();
    expect(current).toMatchObject({ id: homeworkId, result: null });
    expect((await student.student.homework.open({ id: homeworkId })).answers).toEqual([null, null, null, null]);
    expect(await answerAndSubmit(student, homeworkId, "is", [0, 2])).toEqual({ correct: 3, wrong: 0, pending: 1 });

    const submissions = await db().select().from(homeworkSubmission).where(eq(homeworkSubmission.homeworkId, homeworkId));
    expect(submissions.map((s) => [s.attempt, s.isCurrent]).sort()).toEqual([
      [1, false],
      [2, true],
    ]);
    const first = await teacher.teacher.review.get({ id: submissionId });
    expect(first).toMatchObject({ isCurrent: false, attempt: 1, correct: 2, wrong: 2 });
    expect(first.tasks.map((t) => t.answer)).toEqual(["blue", "are", "cat", null]);
    expect(first.attempts.map((a) => [a.attempt, a.isCurrent])).toEqual([
      [2, true],
      [1, false],
    ]);
    // The first attempt is history: no marks, no second reopening.
    await expect(teacher.teacher.review.mark({ id: submissionId, taskIndex: 1, mark: true })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(teacher.teacher.review.reopen({ id: submissionId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      await db().select().from(homeworkAnswer).where(eq(homeworkAnswer.homeworkId, homeworkId)),
    ).toHaveLength(8);
  });

  it("keeps one current submission per homework in the database", async () => {
    const { homeworkId } = await submitted("Индекс");
    await expect(
      db()
        .insert(homeworkSubmission)
        .values({ homeworkId, attempt: 2, idempotencyKey: "x", correctCount: 0, wrongCount: 0 }),
    ).rejects.toThrow();
  });

  it("does not reopen while the student has another published homework", async () => {
    const { studentId, submissionId } = await submitted("Занято");
    const { id } = await teacher.teacher.homework.import({ studentId, json: json(review) });
    await teacher.teacher.homework.publish({ id, dueDate: inDays(4) });
    await expect(teacher.teacher.review.reopen({ id: submissionId })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("treats another teacher's submission like a missing one", async () => {
    const { submissionId, studentId } = await submitted("Чужая");
    const missing = "00000000-0000-4000-8000-000000000000";
    for (const id of [submissionId, missing]) {
      await expect(otherTeacher.teacher.review.get({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(otherTeacher.teacher.review.mark({ id, taskIndex: 0, mark: true })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(otherTeacher.teacher.review.comment({ id, comment: "x" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(otherTeacher.teacher.review.reopen({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await expect(otherTeacher.teacher.review.list({ studentId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Opening someone else's submission marks nothing.
    await otherTeacher.teacher.review.opened({ id: submissionId });
    const [row] = await db().select().from(homeworkSubmission).where(eq(homeworkSubmission.id, submissionId));
    expect(row!.openedAt).toBeNull();
  });

  it("does not count a deleted student's submission, as the list does not show it", async () => {
    const before = await teacher.teacher.review.waiting();
    const { studentId } = await submitted("Удалённый");
    expect(await teacher.teacher.review.waiting()).toBe(before + 1);
    await db().update(student).set({ deletedAt: new Date() }).where(eq(student.id, studentId));
    expect(await teacher.teacher.review.waiting()).toBe(before);
    expect((await teacher.teacher.review.list({ studentId: null })).some((r) => r.studentName === "Удалённый")).toBe(false);
  });
});
