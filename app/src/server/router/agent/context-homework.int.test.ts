import { afterAll, beforeAll, describe, expect, it } from "vitest";
import review from "../../../../../deploy/seed/homework/demo-review.json";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { closeDb } from "../../db/client";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest } from "../index";

// Recent homework in the student context (#44). The synthetic homework: sky
// (colours), gap «is» (to be), animals cat + dog, and a written task the
// teacher checks (my day).

const [teacherA] = seedTeachers as [(typeof seedTeachers)[number]];

let teacher: ReturnType<typeof createServerCaller>;
let assistant: ReturnType<typeof createServerCaller>;

const json = (value: unknown) => JSON.stringify(value);
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** A new student of the teacher, signed in through their link. */
async function newStudent(firstName: string) {
  const { id: studentId } = await teacher.teacher.students.create({
    firstName,
    lastName: "Скрытова",
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
  return { studentId, student: createServerCaller(new Headers({ cookie })) };
}

async function published(studentId: string, title: string) {
  const { id } = await teacher.teacher.homework.import({ studentId, json: json({ ...review, title }) });
  const { revision } = await teacher.teacher.homework.get({ id });
  await teacher.teacher.homework.publish({ id, revision, dueDate: inDays(3) });
  return id;
}

/** The sky right, the gap as given, only «cat» of the animals; the written task blank. */
async function submit(student: ReturnType<typeof createServerCaller>, id: string, gap: string) {
  await student.student.homework.saveAnswer({ id, taskIndex: 0, answer: { type: "single_choice", choice: 0 } });
  await student.student.homework.saveAnswer({ id, taskIndex: 1, answer: { type: "gap", gaps: [gap] } });
  await student.student.homework.saveAnswer({ id, taskIndex: 2, answer: { type: "multiple_choice", choices: [0] } });
  await student.student.homework.submit({ id, idempotencyKey: crypto.randomUUID() });
}

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  const { token } = await teacher.teacher.assistant.createToken();
  assistant = createServerCaller(new Headers({ authorization: `Bearer ${token}` }));
});

afterAll(closeDb);

describe("agent.studentContext: recent homework", () => {
  it("has the submitted homework newest first, with answers, right or wrong, and mistakes by topic", async () => {
    const { studentId, student } = await newStudent("Последние домашки");
    await submit(student, await published(studentId, "First"), "are");
    await submit(student, await published(studentId, "Second"), "is");
    // Published, not submitted: not in the context.
    await published(studentId, "Not submitted");
    // Another student's submission never shows.
    const other = await newStudent("Чужие домашки");
    await submit(other.student, await published(other.studentId, "Another student's"), "are");

    const context = await assistant.agent.studentContext({ studentId });
    expect(context.recentHomework.map((h) => h.title)).toEqual(["Second", "First"]);
    const [second, first] = context.recentHomework;
    expect(first!.tasks).toEqual([
      { prompt: review.tasks[0]!.prompt, type: "single_choice", topic: "colours", source: null, answer: "blue", correct: true, markedByTeacher: false },
      { prompt: review.tasks[1]!.prompt, type: "gap", topic: "to be", source: null, answer: "are", correct: false, markedByTeacher: false },
      { prompt: review.tasks[2]!.prompt, type: "multiple_choice", topic: "animals", source: null, answer: "cat", correct: false, markedByTeacher: false },
      // The written task waits for the teacher.
      { prompt: review.tasks[3]!.prompt, type: "written", topic: "my day", source: null, answer: null, correct: null, markedByTeacher: false },
    ]);
    expect(second!.tasks.map((t) => t.correct)).toEqual([true, true, false, null]);
    expect(second!.comment).toBeNull();

    expect(context.mistakesByTopic).toEqual([
      { topic: "animals", count: 2 },
      { topic: "to be", count: 1 },
    ]);
    const text = JSON.stringify(context);
    for (const hidden of ["Not submitted", "Another student's", "Скрытова"]) expect(text).not.toContain(hidden);
  });

  it("carries the teacher's marks and comment once she reviews", async () => {
    const { studentId, student } = await newStudent("Проверенная домашка");
    await submit(student, await published(studentId, "Reviewed"), "is");
    const submissionId = (await teacher.teacher.review.list({ studentId }))[0]!.submissionId!;
    await teacher.teacher.review.mark({ id: submissionId, taskIndex: 3, mark: false });
    // Her mark wins over the platform's result.
    await teacher.teacher.review.mark({ id: submissionId, taskIndex: 2, mark: true });
    await teacher.teacher.review.comment({ id: submissionId, comment: "Повтори Past Simple." });

    const [reviewed] = (await assistant.agent.studentContext({ studentId })).recentHomework;
    expect(reviewed!.comment).toBe("Повтори Past Simple.");
    expect(reviewed!.tasks.map((t) => [t.correct, t.markedByTeacher])).toEqual([
      [true, false],
      [true, false],
      [true, true],
      [false, true],
    ]);
    expect((await assistant.agent.studentContext({ studentId })).mistakesByTopic).toEqual([{ topic: "my day", count: 1 }]);
  });

  it("keeps the 3 latest, and a reopened homework with the attempt it was submitted with", async () => {
    const { studentId, student } = await newStudent("Три последние");
    const ids: string[] = [];
    for (const title of ["One", "Two", "Three", "Four"]) {
      const id = await published(studentId, title);
      await submit(student, id, "are");
      ids.push(id);
    }
    expect((await assistant.agent.studentContext({ studentId })).recentHomework.map((h) => h.title)).toEqual([
      "Four",
      "Three",
      "Two",
    ]);

    // Reopened, the newest is being done again: it stays with the attempt it was submitted with.
    const submissionId = (await teacher.teacher.review.list({ studentId }))[0]!.submissionId!;
    await teacher.teacher.review.reopen({ id: submissionId });
    const [reopened] = (await assistant.agent.studentContext({ studentId })).recentHomework;
    expect(reopened!.title).toBe("Four");
    expect(reopened!.tasks[1]!.answer).toBe("are");
  });

  it("is empty for a student without submitted homework", async () => {
    const { studentId } = await newStudent("Без домашек");
    await published(studentId, "Only published");
    expect(await assistant.agent.studentContext({ studentId })).toMatchObject({ recentHomework: [], mistakesByTopic: [] });
  });
});
