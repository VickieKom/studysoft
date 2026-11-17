import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "../../db/client";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller } from "../index";

// The results history import (#38). Every test makes its own student with a
// unique last name, so a name in the CSV matches one student however often
// the suite runs against the same database.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];

let teacher: ReturnType<typeof createServerCaller>;
let otherTeacher: ReturnType<typeof createServerCaller>;

const HEADER = "student,submitted_on,homework,task,type,question,answer,correct_answer,result,topic";

async function newStudent(firstName: string) {
  const lastName = `Ф${crypto.randomUUID().slice(0, 8)}`;
  const { id } = await teacher.teacher.students.create({ firstName, lastName, level: "A2", timeZone: "Europe/Moscow" });
  return { id, name: `${firstName} ${lastName}` };
}

const history = (name: string) =>
  [
    HEADER,
    `${name},2026-11-03,Demo 1,1,single_choice,Pick the colour of the sky,blue,blue,correct,colours`,
    `${name},2026-11-03,Demo 1,2,gap,I ___ a student.,is,am,wrong,to be`,
    `${name},2026-11-03,Demo 1,3,written,"Write two sentences, please","I wake up at seven. I go to school.",,,writing`,
    `${name},2026-11-05,Demo 2,1,unknown,Something from the old tool,yes,,correct,`,
  ].join("\n");

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  otherTeacher = createServerCaller(await signedInHeaders(teacherB));
});

afterAll(closeDb);

describe("teacher.history", () => {
  it("makes one past submission per student, date and homework, with the answers and the score from the results", async () => {
    const { id: studentId, name } = await newStudent("История");
    const waiting = await teacher.teacher.review.waiting();

    expect(await teacher.teacher.history.import({ csv: history(name) })).toEqual({ imported: 2, existing: 0, errors: [] });

    const list = await teacher.teacher.history.list({ studentId });
    expect(list.map((s) => [s.title, s.submittedOn, s.correct, s.wrong, s.unchecked])).toEqual([
      ["Demo 2", "2026-11-05", 1, 0, 0],
      ["Demo 1", "2026-11-03", 1, 1, 1],
    ]);
    const demo1 = await teacher.teacher.history.get({ id: list[1]!.id });
    expect(demo1.tasks).toEqual([
      { number: 1, type: "single_choice", question: "Pick the colour of the sky", answer: "blue", correctAnswer: "blue", correct: true, topic: "colours" },
      { number: 2, type: "gap", question: "I ___ a student.", answer: "is", correctAnswer: "am", correct: false, topic: "to be" },
      {
        number: 3,
        type: "written",
        question: "Write two sentences, please",
        answer: "I wake up at seven. I go to school.",
        correctAnswer: null,
        correct: null,
        topic: "writing",
      },
    ]);
    // History never waits for review, and it is not a submission of the platform.
    expect(await teacher.teacher.review.waiting()).toBe(waiting);
    expect(await teacher.teacher.review.list({ studentId })).toEqual([]);
  });

  it("adds nothing when the same file comes again, even twice at once", async () => {
    const { id: studentId, name } = await newStudent("Повтор");
    const results = await Promise.all([
      teacher.teacher.history.import({ csv: history(name) }),
      teacher.teacher.history.import({ csv: history(name) }),
    ]);
    expect(results.reduce((sum, r) => sum + r.imported, 0)).toBe(2);
    expect(await teacher.teacher.history.import({ csv: history(name) })).toEqual({ imported: 0, existing: 2, errors: [] });
    expect(await teacher.teacher.history.list({ studentId })).toHaveLength(2);
  });

  it("imports the valid rows and reports the others by line, a repeated task number included", async () => {
    const { id: studentId, name } = await newStudent("Ошибки");
    const csv = [
      HEADER,
      `${name},2026-11-03,Demo 1,1,single_choice,Sky,blue,blue,correct,colours`,
      `Неизвестный Н.,2026-11-03,Demo 1,1,single_choice,Sky,red,blue,wrong,colours`,
      `${name},2026-11-31,Demo 2,1,single_choice,Grass,green,green,correct,colours`,
      `${name},2026-11-03,Demo 1,1,single_choice,Sky again,red,blue,wrong,colours`,
    ].join("\n");
    expect(await teacher.teacher.history.import({ csv })).toEqual({
      imported: 1,
      existing: 0,
      errors: [
        "Строка 3: ученик «Неизвестный Н.» не найден",
        "Строка 4: дата «2026-11-31» — нужна существующая дата в виде ГГГГ-ММ-ДД",
        "Строка 5: задание 1 уже есть в этой домашке выше",
      ],
    });
    const [only] = await teacher.teacher.history.list({ studentId });
    expect((await teacher.teacher.history.get({ id: only!.id })).tasks.map((t) => t.question)).toEqual(["Sky"]);
  });

  it("matches only this teacher's students and keeps another teacher out", async () => {
    const { id: studentId, name } = await newStudent("Своя история");
    expect((await otherTeacher.teacher.history.import({ csv: history(name) })).imported).toBe(0);
    await teacher.teacher.history.import({ csv: history(name) });
    const [past] = await teacher.teacher.history.list({ studentId });

    await expect(otherTeacher.teacher.history.get({ id: past!.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(otherTeacher.teacher.history.list({ studentId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await otherTeacher.teacher.history.list({ studentId: null })).some((s) => s.studentId === studentId)).toBe(false);
    await expect(
      otherTeacher.teacher.history.get({ id: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
