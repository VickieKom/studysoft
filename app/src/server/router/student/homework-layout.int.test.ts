import { afterAll, beforeAll, describe, expect, it } from "vitest";
import layout from "../../../../../deploy/seed/homework/demo-layout.json";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { closeDb } from "../../db/client";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest } from "../index";

// A workbook exercise's parts (#131): the reading text and the example reach
// the student with the task, never its key, and come back in the review. The
// homework is synthetic (deploy/seed/homework/demo-layout.json).

const [teacherA] = seedTeachers as [(typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;

const json = (value: unknown) => JSON.stringify(value);
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const routerRequest = (path: string, init: RequestInit = {}) => handleRouterRequest(new Request(`${env().APP_URL}/api/trpc/${path}`, init));

async function studentWithLayoutHomework(firstName: string) {
  const { id: studentId } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  const token = (await teacher.teacher.links.student({ studentId })).url.split("#")[1]!;
  const response = await routerRequest("links.exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: json({ token }),
  });
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES.student}=`))!.split(";")[0]!;
  const { id } = await teacher.teacher.homework.import({ studentId, json: json(layout) });
  const { revision } = await teacher.teacher.homework.get({ id });
  await teacher.teacher.homework.publish({ id, revision, dueDate: inDays(3) });
  return { id, studentId, cookie, student: createServerCaller(new Headers({ cookie })) };
}

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
});

afterAll(closeDb);

describe("a workbook exercise's parts", () => {
  it("reach the student with each task that has them, and no key comes with them", async () => {
    const { id, cookie } = await studentWithLayoutHomework("Части задания");
    const passage = layout.tasks[0]!.passage!;
    const opened = await (await routerRequest(`student.homework.open?input=${encodeURIComponent(json({ id }))}`, { headers: { cookie } })).json();
    const tasks = opened.result.data.tasks as { prompt: string; passage?: string; example?: unknown; text?: string }[];

    expect(tasks.map((t) => t.passage ?? null)).toEqual([passage, passage, null]);
    expect(tasks[2]).toMatchObject({ type: "gap", text: "1 They ___ my friends.", example: { text: "0 She ___ a teacher.", answer: "is" } });
    // The keys of the real items never come: the choices' answers and the gap's accepted answers.
    expect(json(opened)).not.toContain("'re");
    // The tasks carry no keys: "answers" in the response is the student's own saved answers, apart from them.
    expect(json(tasks)).not.toMatch(/"answers"|"alternatives"/);
  });

  it("are not counted, and come back in the review", async () => {
    const { id, studentId, student } = await studentWithLayoutHomework("Пример не в счёт");
    await student.student.homework.saveAnswer({ id, taskIndex: 0, answer: { type: "single_choice", choice: 0 } });
    await student.student.homework.saveAnswer({ id, taskIndex: 1, answer: { type: "single_choice", choice: 1 } });
    await student.student.homework.saveAnswer({ id, taskIndex: 2, answer: { type: "gap", gaps: ["are"] } });
    await student.student.homework.submit({ id, idempotencyKey: crypto.randomUUID() });
    expect(await student.student.homework.current()).toMatchObject({ id, result: { correct: 3, wrong: 0 } });

    const submissionId = (await teacher.teacher.review.list({ studentId }))[0]!.submissionId!;
    const review = await teacher.teacher.review.get({ id: submissionId });
    expect(review.tasks.map((t) => [t.passage !== null, t.example?.answer ?? null])).toEqual([
      [true, null],
      [true, null],
      [false, "is"],
    ]);
  });
});
