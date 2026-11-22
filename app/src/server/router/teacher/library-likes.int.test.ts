import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "../../db/client";
import { homework, homeworkSurvey } from "../../db/schema";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller } from "../index";

// «нравится N детям» (#334): a child who picked a material in a survey's
// pair, or both with «Оба классные», counts once per material; another
// teacher's children never count. The surveys are written here as answered.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;
let other: ReturnType<typeof createServerCaller>;
let teacherId: string;
let otherId: string;
const run = crypto.randomUUID().slice(0, 8);

async function game(as: ReturnType<typeof createServerCaller>, title: string) {
  return (await as.teacher.library.addGame({ title, level: "A2", topic: `likes ${run}`, ageGroup: "younger", html: "<!doctype html><title>g</title>" })).id;
}

/** An answered survey of a new student of this teacher, with «Что было веселее» on the pair and the child's picks. */
async function answered(as: ReturnType<typeof createServerCaller>, owner: string, pairs: { a: { id: string; title: string }; b: { id: string; title: string }; pick: string }[]) {
  const { id: studentId } = await as.teacher.students.create({ firstName: `Лайк ${run}`, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  const [hw] = await db().insert(homework).values({ teacherId: owner, studentId, title: "Survey carrier", document: { version: 1, title: "x", tasks: [] }, status: "published" }).returning({ id: homework.id });
  await db()
    .insert(homeworkSurvey)
    .values({
      teacherId: owner,
      studentId,
      homeworkId: hw!.id,
      periodFrom: new Date(Date.now() - 86_400_000),
      periodTo: new Date(),
      questions: pairs.map(({ a, b }) => ({ kind: "fun", a, b })),
      answers: pairs.map((p) => p.pick),
      status: "answered",
    });
}

const likedBy = async (id: string, as = teacher) => (await as.teacher.library.get({ id })).likedBy;

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  other = createServerCaller(await signedInHeaders(teacherB));
  teacherId = (await teacher.teacher.session.me()).id;
  otherId = (await other.teacher.session.me()).id;
});

afterAll(closeDb);

describe("liked materials", () => {
  it("count each child once per material, the pick and «Оба классные», and nothing else", async () => {
    const rocket = { id: await game(teacher, `Rocket ${run}`), title: `Rocket ${run}` };
    const puzzle = { id: await game(teacher, `Puzzle ${run}`), title: `Puzzle ${run}` };
    const maze = { id: await game(teacher, `Maze ${run}`), title: `Maze ${run}` };

    // One child picks the rocket twice: once.
    await answered(teacher, teacherId, [
      { a: rocket, b: puzzle, pick: rocket.title },
      { a: maze, b: rocket, pick: rocket.title },
    ]);
    // Another likes both of the pair; a third finds both «так себе», a fourth skips the question.
    await answered(teacher, teacherId, [{ a: rocket, b: puzzle, pick: "Оба классные" }]);
    await answered(teacher, teacherId, [{ a: rocket, b: maze, pick: "Оба так себе" }]);
    await answered(teacher, teacherId, [{ a: rocket, b: maze, pick: null as unknown as string }]);

    expect(await likedBy(rocket.id)).toBe(2);
    expect(await likedBy(puzzle.id)).toBe(1);
    expect(await likedBy(maze.id)).toBe(0);
    const listed = (await teacher.teacher.library.list({ topic: `likes ${run}` })).materials;
    expect(Object.fromEntries(listed.map((m) => [m.title, m.likedBy]))).toEqual({ [rocket.title]: 2, [puzzle.title]: 1, [maze.title]: 0 });
  });

  it("never count another teacher's children", async () => {
    const mine = { id: await game(teacher, `Mine ${run}`), title: `Mine ${run}` };
    const theirs = { id: await game(other, `Theirs ${run}`), title: `Theirs ${run}` };
    // Another teacher's survey naming her material counts for neither.
    await answered(other, otherId, [{ a: mine, b: theirs, pick: "Оба классные" }]);
    expect(await likedBy(mine.id)).toBe(0);
    expect(await likedBy(theirs.id, other)).toBe(1);
  });
});
