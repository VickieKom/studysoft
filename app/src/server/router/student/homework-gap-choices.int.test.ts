import { afterAll, beforeAll, describe, expect, it } from "vitest";
import choices from "../../../../../deploy/seed/homework/demo-gap-choices.json";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { closeDb } from "../../db/client";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest } from "../index";

// A gap's own options (#128): the student gets them and never the keys; an
// answer must be one of the gap's options; each gap is checked against its
// key. The homework is synthetic (deploy/seed/homework/demo-gap-choices.json):
// gap 1 on / at → on, gap 2 plays / does → plays, gap 3 typed → Mila.

const [teacherA] = seedTeachers as [(typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;

const json = (value: unknown) => JSON.stringify(value);
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const routerRequest = (path: string, init: RequestInit = {}) => handleRouterRequest(new Request(`${env().APP_URL}/api/trpc/${path}`, init));

async function studentWithChoices(firstName: string) {
  const { id: studentId } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  const token = (await teacher.teacher.links.student({ studentId })).url.split("#")[1]!;
  const response = await routerRequest("links.exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: json({ token }),
  });
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES.student}=`))!.split(";")[0]!;
  const { id } = await teacher.teacher.homework.import({ studentId, json: json(choices) });
  const { revision } = await teacher.teacher.homework.get({ id });
  await teacher.teacher.homework.publish({ id, revision, dueDate: inDays(3) });
  return { id, studentId, cookie, student: createServerCaller(new Headers({ cookie })) };
}

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
});

afterAll(closeDb);

describe("a gap's own options", () => {
  it("reach the student without the keys", async () => {
    const { id, cookie } = await studentWithChoices("Варианты пропуска");
    const opened = await (await routerRequest(`student.homework.open?input=${encodeURIComponent(json({ id }))}`, { headers: { cookie } })).json();
    const [task] = opened.result.data.tasks;
    expect(task).toMatchObject({ type: "gap", choices: [["on", "at"], ["plays", "does"], null] });
    expect(json(task)).not.toMatch(/"answers"|Mila/);
  });

  it("take only one of the gap's options, and each gap is checked against its key", async () => {
    const { id, studentId, student } = await studentWithChoices("Выбор в пропуске");
    // An answer that is not among the gap's own options does not fit the task.
    await expect(
      student.student.homework.saveAnswer({ id, taskIndex: 0, answer: { type: "gap", gaps: ["in", "plays", "Mila"] } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // A partial answer is kept: an empty gap is fine.
    await student.student.homework.saveAnswer({ id, taskIndex: 0, answer: { type: "gap", gaps: ["on", "", ""] } });
    // The wrong one of the second gap's options.
    await student.student.homework.saveAnswer({ id, taskIndex: 0, answer: { type: "gap", gaps: ["on", "does", "mila"] } });
    await student.student.homework.submit({ id, idempotencyKey: crypto.randomUUID() });
    expect(await student.student.homework.current()).toMatchObject({ id, result: { correct: 0, wrong: 1 } });

    const submissionId = (await teacher.teacher.review.list({ studentId }))[0]!.submissionId!;
    const [reviewed] = (await teacher.teacher.review.get({ id: submissionId })).tasks;
    expect(reviewed).toMatchObject({ verdict: false, choices: [["on", "at"], ["plays", "does"], null] });

    // The right options and the typed gap: right.
    const next = await studentWithChoices("Верный выбор");
    await next.student.student.homework.saveAnswer({ id: next.id, taskIndex: 0, answer: { type: "gap", gaps: ["on", "plays", " MILA "] } });
    await next.student.student.homework.submit({ id: next.id, idempotencyKey: crypto.randomUUID() });
    expect(await next.student.student.homework.current()).toMatchObject({ result: { correct: 1, wrong: 0 } });
  });
});
