import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import review from "../../../../../deploy/seed/homework/demo-review.json";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { closeDb, db } from "../../db/client";
import { homeworkSubmission, lesson, lessonPlan } from "../../db/schema";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest } from "../index";

// The homework review on the lesson stage (#153). A homework waits for review
// when it is the student's latest submitted one and was submitted after their
// previous held lesson; its stage comes first in the preparation, and at
// «Запустить урок» unless the teacher saved the plan after the submission.
// The stage gets the answers and the keys; a state naming another student's
// homework is refused. The homework is synthetic: sky (colours), gap «is»,
// animals cat + dog, and a written task.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;
let other: ReturnType<typeof createServerCaller>;

const json = (value: unknown) => JSON.stringify(value);
const isoIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function codeOf(call: Promise<unknown>) {
  try {
    await call;
    return "OK";
  } catch (error) {
    return error instanceof TRPCError ? error.code : String(error);
  }
}

async function studentWithLink(firstName: string) {
  const { id: studentId } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  const token = (await teacher.teacher.links.student({ studentId })).url.split("#")[1]!;
  const response = await handleRouterRequest(
    new Request(`${env().APP_URL}/api/trpc/links.exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: json({ token }) }),
  );
  const cookie = response.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${LINK_SESSION_COOKIES.student}=`))!
    .split(";")[0]!;
  return { studentId, student: createServerCaller(new Headers({ cookie })) };
}

/** Publishes the review homework to the student. */
async function published(studentId: string) {
  const { id } = await teacher.teacher.homework.import({ studentId, json: json(review) });
  const { revision } = await teacher.teacher.homework.get({ id });
  await teacher.teacher.homework.publish({ id, revision, dueDate: isoIn(3) });
  return id;
}

/** The student submits with one mistake: «are» in the gap. */
async function submit(student: ReturnType<typeof createServerCaller>, id: string) {
  await student.student.homework.saveAnswer({ id, taskIndex: 0, answer: { type: "single_choice", choice: 0 } });
  await student.student.homework.saveAnswer({ id, taskIndex: 1, answer: { type: "gap", gaps: ["are"] } });
  await student.student.homework.saveAnswer({ id, taskIndex: 2, answer: { type: "multiple_choice", choices: [0, 2] } });
  await student.student.homework.submit({ id, idempotencyKey: crypto.randomUUID() });
  const [row] = await db().select({ submittedAt: homeworkSubmission.submittedAt }).from(homeworkSubmission).where(eq(homeworkSubmission.homeworkId, id));
  return row!.submittedAt;
}

const upcoming = async (studentId: string) =>
  (await teacher.teacher.schedule.addLesson({ studentId, date: isoIn(2), time: "10:00", durationMinutes: 45, intro: false })).id;

/** A lesson of the student held at `startsAt`, 45 minutes long. */
async function heldAt(studentId: string, startsAt: Date) {
  const { id } = await teacher.teacher.schedule.addLesson({ studentId, date: isoIn(-1), time: "10:00", durationMinutes: 45, intro: false });
  await db().update(lesson).set({ startsAt, status: "held" }).where(eq(lesson.id, id));
  return id;
}

const homeworkStages = (plan: { stages: { type: string }[] }) => plan.stages.filter((s) => s.type === "homework");

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  other = createServerCaller(await signedInHeaders(teacherB));
});

afterAll(closeDb);

describe("the homework review on the stage", () => {
  it("proposes a submitted homework first, and the stage gets the score, the answers and the keys", async () => {
    const { studentId, student } = await studentWithLink("Разбор урока");
    const homeworkId = await published(studentId);
    const lessonId = await upcoming(studentId);

    // Published, not submitted: nothing to review.
    expect(homeworkStages((await teacher.teacher.prep.get({ lessonId })).start)).toEqual([]);

    await submit(student, homeworkId);
    const prep = await teacher.teacher.prep.get({ lessonId });
    expect(prep.start.stages[0]).toEqual({ type: "homework", homeworkId, minutes: 10 });
    expect(prep.waitingHomework).toEqual({ id: homeworkId, title: review.title });
    expect(prep.stageHomework).toEqual([{ id: homeworkId, title: review.title }]);

    const opened = await teacher.teacher.lessonMode.open({ lessonId });
    expect(opened.kept.state.stages[0]).toMatchObject({ type: "homework", homeworkId, filter: "all", shown: [] });
    const [shown] = opened.resources.homework;
    expect(shown).toMatchObject({ id: homeworkId, correct: 2, wrong: 1, pending: 1 });
    expect(shown!.tasks.map((t) => [t.answer, t.verdict, t.key])).toEqual([
      ["blue", true, "blue"],
      ["are", false, "is"],
      ["cat, dog", true, "cat, dog"],
      [null, null, null],
    ]);
    expect((await teacher.teacher.lessonMode.stage({ lessonId })).resources.homework).toHaveLength(1);
  });

  it("does not propose a homework submitted before the previous held lesson ended", async () => {
    const { studentId, student } = await studentWithLink("Разбирали");
    const homeworkId = await published(studentId);
    const submittedAt = await submit(student, homeworkId);
    const lessonId = await upcoming(studentId);

    // A lesson held well before the submission: the homework still waits.
    const held = await heldAt(studentId, new Date(submittedAt.getTime() - 2 * 3_600_000));
    expect(homeworkStages((await teacher.teacher.prep.get({ lessonId })).start)).toHaveLength(1);

    // A lesson that started before the submission and ended after it: reviewed there.
    await db().update(lesson).set({ startsAt: new Date(submittedAt.getTime() - 60_000) }).where(eq(lesson.id, held));
    expect((await teacher.teacher.prep.get({ lessonId })).waitingHomework).toBeNull();
    expect(homeworkStages((await teacher.teacher.prep.get({ lessonId })).start)).toEqual([]);
    expect(homeworkStages((await teacher.teacher.lessonMode.open({ lessonId })).kept.state)).toEqual([]);
  });

  it("adds a homework submitted after the plan was saved at launch; one she removed after the submission stays out", async () => {
    const { studentId, student } = await studentWithLink("Позже сдал");
    const homeworkId = await published(studentId);
    const lessonId = await upcoming(studentId);
    await teacher.teacher.prep.save({ lessonId, plan: { stages: [] }, homeworkId: null, revision: "" });
    // The plan was saved before the submission: a moment between them, whatever the clocks.
    await db().update(lessonPlan).set({ updatedAt: new Date(Date.now() - 60_000) }).where(eq(lessonPlan.lessonId, lessonId));
    await submit(student, homeworkId);
    // The assistant's draft after the submission is not the teacher's save: the review is still added.
    const token = (await teacher.teacher.assistant.createToken()).token;
    const assistant = createServerCaller(new Headers({ authorization: `Bearer ${token}` }));
    await assistant.agent.saveLessonPlan({ lessonId, plan: { stages: [] } });
    expect(homeworkStages((await teacher.teacher.lessonMode.open({ lessonId })).kept.state)).toHaveLength(1);

    const removed = await upcoming(studentId);
    expect(homeworkStages((await teacher.teacher.prep.get({ lessonId: removed })).start)).toHaveLength(1);
    await teacher.teacher.prep.save({ lessonId: removed, plan: { stages: [] }, homeworkId: null, revision: "" });
    expect(homeworkStages((await teacher.teacher.prep.get({ lessonId: removed })).start)).toEqual([]);
    expect(homeworkStages((await teacher.teacher.lessonMode.open({ lessonId: removed })).kept.state)).toEqual([]);
  });

  it("keeps the filter and the shown keys, and refuses another student's or another teacher's homework", async () => {
    const { studentId, student } = await studentWithLink("Фильтр разбора");
    const homeworkId = await published(studentId);
    await submit(student, homeworkId);
    const lessonId = await upcoming(studentId);
    const { kept } = await teacher.teacher.lessonMode.open({ lessonId });
    const stage = { ...kept.state.stages[0]!, filter: "wrong", shown: [1] };
    const state = { ...kept.state, stages: [stage] };
    expect((await teacher.teacher.lessonMode.saveState({ lessonId, revision: 1, state })).saved).toBe(true);
    expect((await teacher.teacher.lessonMode.stage({ lessonId })).kept.state.stages[0]).toMatchObject({ filter: "wrong", shown: [1] });

    // Another student's homework, of this teacher: not on this lesson.
    const { studentId: otherStudent } = await studentWithLink("Чужой разбор");
    const foreign = await published(otherStudent);
    const withForeign = { ...kept.state, stages: [{ ...stage, homeworkId: foreign }] };
    expect(await codeOf(teacher.teacher.lessonMode.saveState({ lessonId, revision: 2, state: withForeign }))).toBe("BAD_REQUEST");
    expect(
      await codeOf(teacher.teacher.prep.save({ lessonId, plan: { stages: [{ type: "homework", homeworkId: foreign, minutes: 5 }] }, homeworkId: null, revision: "" })),
    ).toBe("BAD_REQUEST");

    // Another teacher reaches nothing of this lesson.
    expect(await codeOf(other.teacher.lessonMode.stage({ lessonId }))).toBe("NOT_FOUND");
  });
});
