import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanBoard, draw, newSheet } from "../../../domain/board";
import { closeDb } from "../../db/client";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller } from "../index";

// The chalkboard on the stage (#155): kept with the lesson's state on the
// server, so a stage opened again — in this browser or another — shows it as
// it was; each lesson starts with a clean board of one sheet; a board past
// its limits is refused. The words are synthetic.

const [teacherA] = seedTeachers as [(typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;

const isoIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function lessonOf(studentId: string, days: number) {
  return (await teacher.teacher.schedule.addLesson({ studentId, date: isoIn(days), time: "15:00", durationMinutes: 45, intro: false })).id;
}

async function codeOf(call: Promise<unknown>) {
  try {
    await call;
    return "OK";
  } catch (error) {
    return error instanceof TRPCError ? error.code : String(error);
  }
}

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
});

afterAll(closeDb);

describe("the chalkboard of a lesson", () => {
  it("is kept with the lesson's state; the student's next lesson starts with a clean board", async () => {
    const { id: studentId } = await teacher.teacher.students.create({ firstName: "Доска урока", lastName: "", level: "A2", timeZone: "Europe/Moscow" });
    const lessonId = await lessonOf(studentId, 2);
    const { kept } = await teacher.teacher.lessonMode.open({ lessonId });
    expect(kept.state.board).toEqual(cleanBoard());

    const board = newSheet(draw(cleanBoard(), { kind: "text", x: 20, y: 40, text: "kitten", colour: "yellow" }));
    expect((await teacher.teacher.lessonMode.saveState({ lessonId, revision: 1, state: { ...kept.state, board } })).saved).toBe(true);
    expect((await teacher.teacher.lessonMode.stage({ lessonId })).kept.state.board).toEqual(board);

    const next = await lessonOf(studentId, 9);
    expect((await teacher.teacher.lessonMode.open({ lessonId: next })).kept.state.board).toEqual(cleanBoard());
  });

  it("refuses a board past its limits", async () => {
    const { id: studentId } = await teacher.teacher.students.create({ firstName: "Большая доска", lastName: "", level: "A2", timeZone: "Europe/Moscow" });
    const lessonId = await lessonOf(studentId, 3);
    const { kept } = await teacher.teacher.lessonMode.open({ lessonId });
    const tooMany = { sheets: Array.from({ length: 21 }, () => ({ items: [], previous: null })), current: 0 };
    expect(await codeOf(teacher.teacher.lessonMode.saveState({ lessonId, revision: 1, state: { ...kept.state, board: tooMany } }))).toBe("BAD_REQUEST");
  });
});
