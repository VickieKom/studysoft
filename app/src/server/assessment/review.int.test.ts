import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "../db/client";
import { assessment } from "../db/schema";
import { createServerCaller } from "../router/index";
import { seedTeachers, signedInHeaders } from "../testing/requests";

// The teacher's check of an ended assessment (#254): writing and speaking
// scored by the criteria once ended, a percent per skill, «Записать в
// прогресс» into the skill results of the day it ended in the student's time
// zone — replacing that day's results of the same skills, keeping the others
// — and nothing changes after it. The texts are synthetic.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;
let other: ReturnType<typeof createServerCaller>;
let teacherId: string;

// Ended late on 10 November in UTC: 11 November in Moscow.
const ENDED = new Date("2026-11-10T22:30:00Z");
const ENDED_ON = "2026-11-11";
const settledWithin = (promise: Promise<unknown>, ms: number) =>
  Promise.race([promise.then(() => true, () => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms))]);

const document = {
  version: 1,
  title: "Scored assessment",
  sections: [
    { skill: "listening", questions: [{ question: "Where?", options: ["here", "there"], answer: 1 }, { question: "When?", options: ["now", "later"], answer: 0 }] },
    { skill: "reading", text: "The demo box is blue.", questions: [{ type: "true_false", statement: "The box is blue.", answer: "true" }] },
    { skill: "grammar", text: "Pim ___ home.", gaps: [{ options: ["go", "went"], answer: 1 }] },
    { skill: "writing", task: "Write a note." },
    { skill: "speaking", questions: ["What can you see?"] },
  ],
};

/** A student in Moscow with an approved assessment; ended at ENDED unless `ended` is false. Listening half right, reading right, grammar not started. */
async function assessed(firstName: string, ended = true) {
  const { id: studentId } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  const [row] = await db()
    .insert(assessment)
    .values({
      teacherId,
      studentId,
      title: document.title,
      document,
      status: "approved",
      answers: { listening: ["1", "1"], reading: ["true"], writing: ["Dear Pim, I walked to the demo lake."] },
      submittedAt: ended ? ENDED : null,
      finishedAt: ended ? ENDED : null,
      scores: ended ? { listening: { right: 1, total: 2 }, reading: { right: 1, total: 1 } } : null,
    })
    .returning({ id: assessment.id });
  return { studentId, assessmentId: row!.id };
}

const reviewOf = async (studentId: string) => (await teacher.teacher.assessments.list({ studentId }))[0]!.review;

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  other = createServerCaller(await signedInHeaders(teacherB));
  teacherId = (await teacher.teacher.session.me()).id;
});

afterAll(closeDb);

describe("the check of an assessment", () => {
  it("is not there, and nothing is scored or written, before the assessment ends", async () => {
    const { studentId, assessmentId } = await assessed("Незавершённый замер", false);
    expect(await reviewOf(studentId)).toBeNull();
    await expect(teacher.teacher.assessments.score({ assessmentId, section: "writing", scores: [1, 1, 1] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Сначала завершите замер",
    });
    await expect(teacher.teacher.assessments.writeToProgress({ assessmentId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("scores writing and speaking, gives a percent per skill, and writes them into «Прогресс» at the day it ended", async () => {
    const { studentId, assessmentId } = await assessed("Оценённый замер");
    expect(await reviewOf(studentId)).toEqual({
      writing: "Dear Pim, I walked to the demo lake.",
      criteria: {},
      percents: [
        { skill: "listening", percent: 50 },
        { skill: "reading", percent: 100 },
      ],
      complete: false,
      written: false,
    });
    await expect(teacher.teacher.assessments.writeToProgress({ assessmentId })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Оцените письмо и говорение" });

    await teacher.teacher.assessments.score({ assessmentId, section: "writing", scores: [2, 1, 1] });
    await teacher.teacher.assessments.score({ assessmentId, section: "speaking", scores: [0, 0, 0] });
    // Scored again before the write: the latest counts.
    await teacher.teacher.assessments.score({ assessmentId, section: "speaking", scores: [2, 2, 1] });
    expect(await reviewOf(studentId)).toMatchObject({
      criteria: { writing: [2, 1, 1], speaking: [2, 2, 1] },
      percents: [
        { skill: "listening", percent: 50 },
        { skill: "reading", percent: 100 },
        { skill: "writing", percent: 67 },
        { skill: "speaking", percent: 83 },
      ],
      complete: true,
    });

    // Results of that day entered by hand: the assessment's skills replace theirs, the others stay.
    await teacher.teacher.progress.save({ studentId, date: ENDED_ON, previousDate: null, results: { reading: 10, grammar: 40 } });
    expect(await teacher.teacher.assessments.writeToProgress({ assessmentId })).toEqual({ date: ENDED_ON });
    const results = (await teacher.teacher.progress.get({ studentId })).results.filter((r) => r.measuredOn === ENDED_ON);
    expect(Object.fromEntries(results.map((r) => [r.skill, r.percent]))).toEqual({ listening: 50, reading: 100, grammar: 40, writing: 67, speaking: 83 });
    expect((await reviewOf(studentId))!.written).toBe(true);

    // Frozen: corrected in «Прогресс», not here.
    await expect(teacher.teacher.assessments.score({ assessmentId, section: "writing", scores: [0, 0, 0] })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(teacher.teacher.assessments.writeToProgress({ assessmentId })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses a section the assessment does not have, a score out of 0–2, and another teacher", async () => {
    const { assessmentId } = await assessed("Чужой замер");
    await db().update(assessment).set({ document: { ...document, sections: document.sections.filter((s) => s.skill !== "speaking") } }).where(eq(assessment.id, assessmentId));
    await expect(teacher.teacher.assessments.score({ assessmentId, section: "speaking", scores: [1, 1, 1] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(teacher.teacher.assessments.score({ assessmentId, section: "writing", scores: [3, 1, 1] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(teacher.teacher.assessments.score({ assessmentId, section: "writing", scores: [1, 1] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(other.teacher.assessments.score({ assessmentId, section: "writing", scores: [1, 1, 1] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.teacher.assessments.writeToProgress({ assessmentId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Without «Говорение», writing alone completes it.
    await teacher.teacher.assessments.score({ assessmentId, section: "writing", scores: [1, 1, 1] });
    expect(await teacher.teacher.assessments.writeToProgress({ assessmentId })).toEqual({ date: ENDED_ON });
  });
});

describe("a score and «Записать в прогресс» at once", () => {
  it("a score that read the assessment before the write is refused once the write commits", async () => {
    const { studentId, assessmentId } = await assessed("Оценка и запись");
    await teacher.teacher.assessments.score({ assessmentId, section: "writing", scores: [1, 1, 1] });
    let score: Promise<unknown> | undefined;
    await db().transaction(async (tx) => {
      // The write's lock and its mark, not committed yet.
      await tx.select({ id: assessment.id }).from(assessment).where(eq(assessment.id, assessmentId)).for("update");
      await tx.update(assessment).set({ progressWrittenAt: new Date() }).where(eq(assessment.id, assessmentId));
      // The score reads the assessment as it was, then waits on the row.
      score = teacher.teacher.assessments.score({ assessmentId, section: "writing", scores: [2, 2, 2] });
      expect(await settledWithin(score, 300)).toBe(false);
    });
    await expect(score!).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await reviewOf(studentId))!.criteria.writing).toEqual([1, 1, 1]);
  });

  it("two writes wait for each other on the assessment: the second finds it written", async () => {
    const { assessmentId } = await assessed("Две записи");
    await teacher.teacher.assessments.score({ assessmentId, section: "writing", scores: [1, 1, 1] });
    await teacher.teacher.assessments.score({ assessmentId, section: "speaking", scores: [1, 1, 1] });
    let second: Promise<unknown> | undefined;
    await db().transaction(async (tx) => {
      await tx.select({ id: assessment.id }).from(assessment).where(eq(assessment.id, assessmentId)).for("update");
      second = teacher.teacher.assessments.writeToProgress({ assessmentId });
      expect(await settledWithin(second, 300)).toBe(false);
      // The first write's mark.
      await tx.update(assessment).set({ progressWrittenAt: new Date() }).where(eq(assessment.id, assessmentId));
    });
    await expect(second!).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
