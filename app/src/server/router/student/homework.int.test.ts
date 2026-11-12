import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import autoChecked from "../../../../../deploy/seed/homework/demo-auto-checked.json";
import type { Answer } from "../../../domain/homework-format";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { closeDb, db } from "../../db/client";
import { homeworkAnswer, homeworkSubmission } from "../../db/schema";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest } from "../index";

// The student does a homework (#34). The synthetic key: colour = blue,
// animals = cat + dog, gap = it's / it is, pairs hot–cold and big–small,
// order «We play after school».

const [teacherA] = seedTeachers as [(typeof seedTeachers)[number]];

let teacher: ReturnType<typeof createServerCaller>;

const json = (value: unknown) => JSON.stringify(value);
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

function routerRequest(path: string, init: RequestInit = {}) {
  return handleRouterRequest(new Request(`${env().APP_URL}/api/trpc/${path}`, init));
}

/** A new student with a published copy of the synthetic homework; returns the student's caller and cookie. */
async function studentWithHomework(firstName: string) {
  const { id: studentId } = await teacher.teacher.students.create({
    firstName,
    lastName: "",
    level: "A2",
    timeZone: "Europe/Moscow",
  });
  const token = (await teacher.teacher.links.student({ studentId })).url.split("#")[1]!;
  const response = await routerRequest("links.exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: json({ token }),
  });
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES.student}=`))!.split(";")[0]!;
  const { id } = await teacher.teacher.homework.import({ studentId, json: json(autoChecked) });
  await teacher.teacher.homework.publish({ id, dueDate: inDays(3) });
  return { id, studentId, cookie, student: createServerCaller(new Headers({ cookie })) };
}

const raw = async (cookie: string, path: string, init: RequestInit = {}) =>
  (await routerRequest(path, { ...init, headers: { ...init.headers, cookie } })).text();

const query = (input: unknown) => `?input=${encodeURIComponent(json(input))}`;

const right: Answer[] = [
  { type: "single_choice", choice: 1 },
  { type: "multiple_choice", choices: [0, 2] },
  { type: "gap", gaps: ["  IT’S "] },
  {
    type: "match",
    pairs: [
      { left: "hot", right: "cold" },
      { left: "big", right: "small" },
    ],
  },
  { type: "order", words: ["We", "play", "after", "school"] },
];

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
});

afterAll(closeDb);

describe("student.homework", () => {
  it("never sends a key before submission, from any student procedure", async () => {
    const { id, cookie } = await studentWithHomework("Ключи");
    const current = await raw(cookie, "student.homework.current");
    const opened = await raw(cookie, `student.homework.open${query({ id })}`);
    const saved = await raw(cookie, "student.homework.saveAnswer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: json({ id, taskIndex: 0, answer: { type: "single_choice", choice: 0 } }),
    });
    const me = await raw(cookie, "student.me");

    for (const body of [current, opened, saved, me]) {
      expect(body).not.toMatch(/"answer"|"alternatives"|"pairs"|"correct"/);
      expect(body).not.toMatch(/it's|it is/i);
    }
    // The tiles are shuffled: neither the solved order nor the pairs in key order.
    expect(opened).not.toContain(json(["We", "play", "after", "school"]));
    expect(opened).not.toContain(json(["cold", "small"]));
    expect(opened).toContain("Pick the colour of the sky.");
  });

  it("keeps the saved answers for another device and refuses an answer that does not fit", async () => {
    const { id, cookie } = await studentWithHomework("Устройства");
    const first = createServerCaller(new Headers({ cookie }));
    await first.student.homework.saveAnswer({ id, taskIndex: 0, answer: right[0]! });
    await first.student.homework.saveAnswer({ id, taskIndex: 1, answer: { type: "multiple_choice", choices: [0] } });

    const other = createServerCaller(new Headers({ cookie }));
    const { answers } = await other.student.homework.open({ id });
    expect(answers).toEqual([right[0], { type: "multiple_choice", choices: [0] }, null, null, null]);

    await expect(
      other.student.homework.saveAnswer({ id, taskIndex: 0, answer: { type: "single_choice", choice: 7 } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      other.student.homework.saveAnswer({ id, taskIndex: 2, answer: { type: "order", words: ["x"] } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      other.student.homework.saveAnswer({ id, taskIndex: 9, answer: right[0]! }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("submits once with the score, stores every answer with its correctness and topic, and refuses a second one", async () => {
    const { id, student } = await studentWithHomework("Сдача");
    // Right: colour, gap (case, spaces, typographic apostrophe), pairs. Wrong: animals (one of two). Unanswered: order.
    await student.student.homework.saveAnswer({ id, taskIndex: 0, answer: right[0]! });
    await student.student.homework.saveAnswer({ id, taskIndex: 1, answer: { type: "multiple_choice", choices: [0] } });
    await student.student.homework.saveAnswer({ id, taskIndex: 2, answer: right[2]! });
    await student.student.homework.saveAnswer({ id, taskIndex: 3, answer: right[3]! });

    const key = crypto.randomUUID();
    expect(await student.student.homework.submit({ id, idempotencyKey: key })).toEqual({ correct: 3, wrong: 2 });
    // The same request again (a double tap, a retry) gets the same result.
    expect(await student.student.homework.submit({ id, idempotencyKey: key })).toEqual({ correct: 3, wrong: 2 });
    await expect(student.student.homework.submit({ id, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await db().select().from(homeworkSubmission).where(eq(homeworkSubmission.homeworkId, id))).toHaveLength(1);

    const stored = await db().select().from(homeworkAnswer).where(eq(homeworkAnswer.homeworkId, id));
    expect(stored.sort((a, b) => a.taskIndex - b.taskIndex).map((a) => [a.correct, a.topic, a.skill])).toEqual(
      autoChecked.tasks.map((task, i) => [[true, false, true, true, false][i], task.topic, task.skill]),
    );
    expect(stored.find((a) => a.taskIndex === 4)!.answer).toBeNull();

    // After submission: the score, no tasks, no more saving, and the teacher cannot take it back.
    expect(await student.student.homework.current()).toMatchObject({ id, result: { correct: 3, wrong: 2 } });
    await expect(student.student.homework.open({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(student.student.homework.saveAnswer({ id, taskIndex: 4, answer: right[4]! })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(teacher.teacher.homework.unpublish({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const list = await teacher.teacher.homework.list({ studentId: (await teacher.teacher.homework.get({ id })).studentId });
    expect(list.find((h) => h.id === id)?.status).toBe("submitted");
  });

  it("makes concurrent submissions with different keys end in exactly one", async () => {
    const { id, student } = await studentWithHomework("Двойной");
    const results = await Promise.allSettled(
      [crypto.randomUUID(), crypto.randomUUID()].map((idempotencyKey) =>
        student.student.homework.submit({ id, idempotencyKey }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db().select().from(homeworkSubmission).where(eq(homeworkSubmission.homeworkId, id))).toHaveLength(1);
  });

  it("can still be done past the deadline, until the next homework is published", async () => {
    const { id, studentId, student } = await studentWithHomework("Просрочка");
    // The deadline has passed: the homework is still open.
    await teacher.teacher.homework.unpublish({ id });
    await teacher.teacher.homework.publish({ id, dueDate: inDays(-2) });
    await student.student.homework.saveAnswer({ id, taskIndex: 0, answer: right[0]! });
    expect((await student.student.homework.open({ id })).answers[0]).toEqual(right[0]);

    const { id: next } = await teacher.teacher.homework.import({ studentId, json: json(autoChecked) });
    await teacher.teacher.homework.publish({ id: next, dueDate: inDays(4) });
    await expect(student.student.homework.open({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await student.student.homework.current()).toMatchObject({ id: next, result: null });
  });

  it("drops the unsubmitted answers when the teacher takes the homework back", async () => {
    const { id, student } = await studentWithHomework("Снятие");
    await student.student.homework.saveAnswer({ id, taskIndex: 0, answer: right[0]! });
    await teacher.teacher.homework.unpublish({ id });
    expect(await db().select().from(homeworkAnswer).where(eq(homeworkAnswer.homeworkId, id))).toHaveLength(0);
    await teacher.teacher.homework.publish({ id, dueDate: inDays(2) });
    expect((await student.student.homework.open({ id })).answers).toEqual([null, null, null, null, null]);
  });

  it("treats another student's homework like a missing one", async () => {
    const { id } = await studentWithHomework("Свой");
    const { student: stranger } = await studentWithHomework("Чужой");
    await expect(stranger.student.homework.open({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(stranger.student.homework.saveAnswer({ id, taskIndex: 0, answer: right[0]! })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(stranger.student.homework.submit({ id, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
