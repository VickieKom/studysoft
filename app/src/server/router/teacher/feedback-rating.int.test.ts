import { afterAll, beforeAll, describe, expect, it } from "vitest";
import short from "../../../../../deploy/seed/homework/demo-short.json";
import { closeDb, db } from "../../db/client";
import { homeworkFeedback, homeworkSurvey } from "../../db/schema";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { appRouter, createServerCaller } from "../index";

// «Что заходит» (#333): the one-tap answers rate the homework's kinds of
// tasks, the surveys' «Что было веселее?» the lesson materials' kinds, «3 из
// 3» chosen in three answers of three; «Про что хочется ещё?» lists the
// topics. «Новый фидбэк» marks a student with answers after «Фидбэк» last came on
// the teacher's screen; across students the ratings add up. Another teacher, a
// student and a parent get none of it. The answers are synthetic.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;
let other: ReturnType<typeof createServerCaller>;
let teacherId: string;
const run = crypto.randomUUID().slice(0, 8);
const games: { id: string; title: string }[] = [];
const videos: { id: string; title: string }[] = [];

async function newStudent(firstName: string) {
  return (await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" })).id;
}

/** A one-tap answer after a homework of demo-short.json (single choice and written). */
async function miniAnswer(studentId: string, answer: string | null) {
  const { id } = await teacher.teacher.homework.import({ studentId, json: JSON.stringify(short) });
  await db().insert(homeworkFeedback).values({ teacherId, studentId, homeworkId: id, answer });
}

/** An answered survey: three pairs, each game against a video, the picks given; and «Про что хочется ещё?». */
async function survey(studentId: string, picks: string[], more: string | null) {
  const { id } = await teacher.teacher.homework.import({ studentId, json: JSON.stringify(short) });
  const questions = [
    ...games.map((g, i) => ({ kind: "fun", a: g, b: videos[i]! })),
    { kind: "more", topics: ["planets", "pets"] },
    { kind: "wish" },
  ];
  const now = new Date();
  await db()
    .insert(homeworkSurvey)
    .values({ teacherId, studentId, homeworkId: id, periodFrom: now, periodTo: now, questions, answers: [...picks, more, null], status: "answered", answeredAt: now });
}

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  other = createServerCaller(await signedInHeaders(teacherB));
  teacherId = (await teacher.teacher.session.me()).id;
  for (const n of [1, 2, 3]) {
    const title = `Rating game ${n} ${run}`;
    games.push({ id: (await teacher.teacher.library.addGame({ title, level: "A2", topic: "rating", ageGroup: "younger", html: "<!doctype html><title>g</title>" })).id, title });
    const clip = `Rating clip ${n} ${run}`;
    videos.push({ id: (await teacher.teacher.library.addVideoLink({ title: clip, level: "A2", topic: "rating", ageGroup: "younger", url: "https://video.example.test/r" })).id, title: clip });
  }
});

afterAll(closeDb);

describe("«Что заходит»", () => {
  it("rates the homework's kinds and the lesson materials' kinds, games «3 из 3», and lists the topics", async () => {
    const studentId = await newStudent("Рейтинговый");
    await miniAnswer(studentId, "single_choice");
    await miniAnswer(studentId, "single_choice");
    await miniAnswer(studentId, null);
    await survey(studentId, games.map((g) => g.title), "planets");
    expect(await teacher.teacher.students.feedbackRating({ studentId })).toEqual({
      tasks: [{ key: "single_choice", chosen: 2, of: 2 }],
      materials: [{ key: "game", chosen: 3, of: 3 }],
      topics: [{ topic: "planets", chosen: 1 }],
    });
    await expect(other.teacher.students.feedbackRating({ studentId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("counts «Оба классные» for both kinds, «Оба так себе» for none, «Все классные» for every kind of its homework", async () => {
    const studentId = await newStudent("Всё нравится");
    await miniAnswer(studentId, "all");
    await survey(studentId, ["Оба классные", "Оба так себе", videos[2]!.title], null);
    const rating = await teacher.teacher.students.feedbackRating({ studentId });
    expect(rating.tasks).toEqual([
      { key: "single_choice", chosen: 1, of: 1 },
      { key: "written", chosen: 1, of: 1 },
    ]);
    expect(rating.materials).toEqual([
      { key: "video", chosen: 2, of: 3 },
      { key: "game", chosen: 1, of: 3 },
    ]);
  });
});

describe("«Новый фидбэк»", () => {
  it("marks a student with answers until «Фидбэк» is seen, and again after a new answer; the ratings add up across students", async () => {
    const studentId = await newStudent("Новый фидбэк");
    const marked = async () => (await teacher.teacher.home.feedback()).newFeedback.some((s) => s.id === studentId);
    expect(await marked()).toBe(false);
    await miniAnswer(studentId, "written");
    expect(await marked()).toBe(true);
    await teacher.teacher.students.seeFeedback({ studentId });
    expect(await marked()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await survey(studentId, games.map((g) => g.title), null);
    expect(await marked()).toBe(true);
    // Another teacher neither sees the student nor opens their card.
    expect((await other.teacher.home.feedback()).newFeedback.some((s) => s.id === studentId)).toBe(false);
    await expect(other.teacher.students.seeFeedback({ studentId })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const across = (await teacher.teacher.home.feedback()).across;
    expect(across.materials[0]!.key).toBe("game");
    expect(across.materials[0]!.chosen).toBeGreaterThanOrEqual(6);
  });

  it("is never given to a student or a parent: no procedure of theirs names the feedback", () => {
    const theirs = Object.keys(appRouter._def.procedures).filter((p) => /^(student|parent)\./.test(p));
    expect(theirs.filter((p) => /rating|seeFeedback|newFeedback|feedbackRating/i.test(p))).toEqual([]);
  });
});
