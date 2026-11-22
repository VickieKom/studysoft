import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import oneKind from "../../../../../deploy/seed/homework/demo-one-kind.json";
import short from "../../../../../deploy/seed/homework/demo-short.json";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "../../db/client";
import { homeworkSubmission } from "../../db/schema";
import { answerFrom, miniQuestion } from "../../homework/feedback";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { appRouter, createServerCaller, handleRouterRequest } from "../index";

// «Мини-вопрос после домашки» (#331): asked after the first «Сдать» of a
// homework published with the box ticked, of more than one kind of task;
// answered or skipped once; shown to the teacher in «Фидбэк»; returned by no
// student or parent procedure. The homework is synthetic
// (deploy/seed/homework/demo-short.json, demo-one-kind.json).

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;
let other: ReturnType<typeof createServerCaller>;
let teacherId: string;

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function linkCaller(studentId: string, role: "student" | "parent") {
  const link = role === "student" ? (await teacher.teacher.links.student({ studentId })).url : (await teacher.teacher.links.parent({ studentId })).url;
  const response = await handleRouterRequest(
    new Request(`${env().APP_URL}/api/trpc/links.exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: link.split("#")[1]! }) }),
  );
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES[role]}=`))!.split(";")[0]!;
  return createServerCaller(new Headers({ cookie }));
}

/** A new student with a homework published, the box ticked or not; returns the homework, the student and their caller. */
async function published(firstName: string, ask: boolean, document: unknown = short) {
  const { id: studentId } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  const { id } = await teacher.teacher.homework.import({ studentId, json: JSON.stringify(document) });
  // Off by default, the assistant's drafts included.
  expect((await teacher.teacher.homework.get({ id })).askFeedback).toBe(false);
  const { revision } = await teacher.teacher.homework.get({ id });
  await teacher.teacher.homework.publish({ id, revision, dueDate: inDays(3), askFeedback: ask });
  return { id, studentId, student: await linkCaller(studentId, "student") };
}

/** «Открыть заново для ученика» on the homework's current submission (#36). */
async function reopen(homeworkId: string) {
  const [current] = await db()
    .select({ id: homeworkSubmission.id })
    .from(homeworkSubmission)
    .where(and(eq(homeworkSubmission.homeworkId, homeworkId), eq(homeworkSubmission.isCurrent, true)));
  await teacher.teacher.review.reopen({ id: current!.id });
}

const submit = (student: ReturnType<typeof createServerCaller>, id: string) => student.student.homework.submit({ id, idempotencyKey: randomUUID() });

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  other = createServerCaller(await signedInHeaders(teacherB));
  teacherId = (await teacher.teacher.session.me()).id;
});

afterAll(closeDb);

describe("the mini-question after the homework", () => {
  it("is asked after «Сдать» with the kinds of the tasks, answered once, and shown to the teacher in «Фидбэк»", async () => {
    const { id, studentId, student } = await published("Ответивший", true);
    // Not before «Сдать».
    expect(await student.student.homework.miniQuestion({ id })).toBeNull();
    await submit(student, id);
    expect(await student.student.homework.miniQuestion({ id })).toEqual({ kinds: ["single_choice", "written"] });

    // Only a kind it offered, or «Все классные».
    await expect(student.student.homework.answerMiniQuestion({ id, answer: "match" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await student.student.homework.answerMiniQuestion({ id, answer: "written" });
    // Once: then nothing to ask, and a second answer is refused.
    expect(await student.student.homework.miniQuestion({ id })).toBeNull();
    await expect(student.student.homework.answerMiniQuestion({ id, answer: "all" })).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(await teacher.teacher.students.feedback({ studentId })).toEqual([
      { homeworkTitle: short.title, answer: "written", answeredAt: expect.any(String) },
    ]);
    await expect(other.teacher.students.feedback({ studentId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // The score is untouched by it.
    expect((await student.student.homework.current())!.result).toMatchObject({ correct: 0 });
  });

  it("is not asked without the box, nor for a homework of one kind of task", async () => {
    const unticked = await published("Без галочки", false);
    await submit(unticked.student, unticked.id);
    expect(await unticked.student.student.homework.miniQuestion({ id: unticked.id })).toBeNull();
    await expect(unticked.student.student.homework.answerMiniQuestion({ id: unticked.id, answer: "all" })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const single = await published("Один вид", true, oneKind);
    await submit(single.student, single.id);
    expect(await single.student.student.homework.miniQuestion({ id: single.id })).toBeNull();
  });

  it("leaves no answer when skipped, and is gone", async () => {
    const { id, studentId, student } = await published("Пропустивший", true);
    await submit(student, id);
    await student.student.homework.answerMiniQuestion({ id, answer: null });
    expect(await student.student.homework.miniQuestion({ id })).toBeNull();
    expect(await teacher.teacher.students.feedback({ studentId })).toEqual([]);
  });

  it("is asked after the first «Сдать» only: a homework reopened for the student asks nothing", async () => {
    const { id, student } = await published("Переоткрытый", true);
    await submit(student, id);
    // The child has not answered yet when the teacher reopens the homework.
    await reopen(id);
    await submit(student, id);
    expect(await student.student.homework.miniQuestion({ id })).toBeNull();
  });

  it("takes no answer for a homework reopened between the read of the question and the answer", async () => {
    const { id, studentId, student } = await published("Гонка с вопросом", true);
    await submit(student, id);
    // The question has been read...
    const question = await miniQuestion(db(), teacherId, studentId, id);
    expect(question).not.toBeNull();
    // ...the teacher reopens the homework...
    await reopen(id);
    // ...and the answer against that read is written nowhere.
    expect(await answerFrom(db(), teacherId, studentId, id, question!, "written")).toBe(false);
    await expect(student.student.homework.answerMiniQuestion({ id, answer: "written" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await teacher.teacher.students.feedback({ studentId })).toEqual([]);
  });

  it("is never returned by a student or parent procedure", async () => {
    const procedures = Object.keys(appRouter._def.procedures).filter((p) => /^(student|parent)\./.test(p));
    // The student has the question and the answer to send, nothing that reads answers back.
    expect(procedures.filter((p) => /feedback|miniQuestion/i.test(p)).sort()).toEqual(["student.homework.answerMiniQuestion", "student.homework.miniQuestion"]);
    const { id, studentId, student } = await published("Секретный ответ", true);
    await submit(student, id);
    await student.student.homework.answerMiniQuestion({ id, answer: "written" });
    const parent = await linkCaller(studentId, "parent");
    const outputs = JSON.stringify([
      await student.student.me(),
      await student.student.homework.current(),
      await student.student.homework.miniQuestion({ id }),
      await parent.parent.me(),
      await parent.parent.progress(),
      await parent.parent.reports(),
    ]);
    expect(outputs).not.toMatch(/written|Написать|homework_feedback/);
  });
});
