import { afterAll, beforeAll, describe, expect, it } from "vitest";
import short from "../../../../../deploy/seed/homework/demo-short.json";
import { closeDb, db } from "../../db/client";
import { homeworkFeedback, homeworkSurvey } from "../../db/schema";
import { BOTH_MEH } from "../../../domain/survey";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller } from "../index";

// The child's feedback in the assistant's student context (#335): «что
// заходит» as the card rates it (#333), the kinds in pairs answered «Оба
// так себе», which the ratings leave out, the topics whose latest «Насколько
// понятно» is «пока путаюсь», and the latest «А ещё я хочу…». Another
// student's answers never show. The answers are synthetic.

const [teacherA] = seedTeachers as [(typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;
let assistant: ReturnType<typeof createServerCaller>;
let teacherId: string;
const run = crypto.randomUUID().slice(0, 8);
let gameId: string;
let videoId: string;

async function newStudent(firstName: string) {
  return (await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" })).id;
}

/** An answered survey of one pair, two clarity questions and a wish, answered `minutesAgo` ago. */
async function survey(studentId: string, answers: (string | null)[], minutesAgo: number) {
  const { id } = await teacher.teacher.homework.import({ studentId, json: JSON.stringify(short) });
  const at = new Date(Date.now() - minutesAgo * 60_000);
  const questions = [
    { kind: "fun", a: { id: gameId, title: `Context game ${run}` }, b: { id: videoId, title: `Context clip ${run}` } },
    { kind: "clear", topic: "comets" },
    { kind: "clear", topic: "rivers" },
    { kind: "wish" },
  ];
  await db().insert(homeworkSurvey).values({ teacherId, studentId, homeworkId: id, periodFrom: at, periodTo: at, questions, answers, status: "answered", answeredAt: at });
}

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  teacherId = (await teacher.teacher.session.me()).id;
  assistant = createServerCaller(new Headers({ authorization: `Bearer ${(await teacher.teacher.assistant.createToken()).token}` }));
  gameId = (await teacher.teacher.library.addGame({ title: `Context game ${run}`, level: "A2", topic: "comets", ageGroup: "younger", html: "<!doctype html><title>g</title>" })).id;
  videoId = (await teacher.teacher.library.addVideoLink({ title: `Context clip ${run}`, level: "A2", topic: "rivers", ageGroup: "younger", url: "https://video.example.test/c" })).id;
});

afterAll(closeDb);

describe("the child's feedback in the student context", () => {
  it("holds «что заходит», the kinds of «Оба так себе», the topics the latest answer finds hard, and the latest wishes, newest first", async () => {
    const studentId = await newStudent("Контекст обратной связи");
    // Earlier: comets hard, rivers hard; later: rivers understood — only comets stays hard.
    await survey(studentId, [`Context game ${run}`, "пока путаюсь", "пока путаюсь", "Про планеты"], 60);
    await survey(studentId, [`Context game ${run}`, "пока путаюсь", "могу объяснить", "Больше игр"], 10);
    // The same pair once more, «Оба так себе»: no kind chosen, both kinds in a pair found so.
    await survey(studentId, [BOTH_MEH, null, null, null], 30);
    const { id } = await teacher.teacher.homework.import({ studentId, json: JSON.stringify(short) });
    await db().insert(homeworkFeedback).values({ teacherId, studentId, homeworkId: id, answer: "written" });

    const { feedback } = await assistant.agent.studentContext({ studentId });
    expect(feedback).toEqual({
      lessonMaterials: [{ kind: "game", chosen: 2, of: 3 }],
      lessonMaterialsMeh: [
        { kind: "game", meh: 1, of: 3 },
        { kind: "video", meh: 1, of: 3 },
      ],
      homeworkTasks: [{ kind: "written", chosen: 1, of: 1 }],
      topics: [],
      struggling: ["comets"],
      wishes: ["Больше игр", "Про планеты"],
    });
  });

  it("never shows another student's answers", async () => {
    const answered = await newStudent("Ответил на опрос");
    const quiet = await newStudent("Не отвечал");
    await survey(answered, [`Context game ${run}`, "пока путаюсь", null, "Секретное желание"], 5);
    const { feedback } = await assistant.agent.studentContext({ studentId: quiet });
    expect(feedback).toEqual({ lessonMaterials: [], lessonMaterialsMeh: [], homeworkTasks: [], topics: [], struggling: [], wishes: [] });
    expect(JSON.stringify(await assistant.agent.studentContext({ studentId: quiet }))).not.toContain("Секретное желание");
  });
});
