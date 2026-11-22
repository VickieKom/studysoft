import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { closeDb, db } from "../../db/client";
import { gameAccess, lesson, videoAnswer } from "../../db/schema";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest } from "../index";

// The student answers a library video's tasks under it (#327): only the
// confirmed tasks, only while the video is open to them, once per lesson;
// no key before «Готово» and no verdict after; the wrong answers join
// «Ошибки по темам» as from the video; after the access ends the tasks are
// closed and the answers kept. The tasks are synthetic.

const [teacherA] = seedTeachers as [(typeof seedTeachers)[number]];
const MINUTE = 60_000;
let teacher: ReturnType<typeof createServerCaller>;
let assistant: ReturnType<typeof createServerCaller>;
let teacherId: string;

const run = crypto.randomUUID().slice(0, 8);
const tags = (title: string) => ({ title, level: "A2" as const, topic: `video answers ${run}`, ageGroup: "younger" as const });
const trueFalse = (prompt: string, answer: 0 | 1) => ({ type: "single_choice", prompt, options: ["True", "False"], answer, topic: `robot ${run}` });
const TASKS = {
  version: 1,
  title: "Robot morning",
  tasks: [trueFalse("The robot wakes up at seven.", 0), trueFalse("The robot drinks milk.", 1), { type: "written", prompt: "What does the robot like?" }],
};

async function sessionOf(studentId: string) {
  const token = (await teacher.teacher.links.student({ studentId })).url.split("#")[1]!;
  const response = await handleRouterRequest(
    new Request(`${env().APP_URL}/api/trpc/links.exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }),
  );
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES.student}=`))!.split(";")[0]!;
  return { cookie, student: createServerCaller(new Headers({ cookie })) };
}

/** A student with a lesson going on, a video with confirmed tasks (or none) opened to them. */
async function opened(firstName: string, withTasks = true) {
  const { id: studentId } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  await db().insert(lesson).values({ teacherId, studentId, startsAt: new Date(Date.now() - 5 * MINUTE), durationMinutes: 45 });
  const { id } = await teacher.teacher.library.addVideoLink({ ...tags(`${firstName} clip`), url: "https://video.example.test/robot" });
  if (withTasks) {
    await assistant.agent.saveVideoTasksDraft({ videoId: id, tasks: TASKS });
    await teacher.teacher.library.confirmVideoTasks({ id, revision: (await teacher.teacher.library.videoTasks({ id })).draft!.revision });
  }
  await teacher.teacher.library.openToStudent({ id, studentId });
  return { id, studentId, ...(await sessionOf(studentId)) };
}

const raw = async (cookie: string, path: string) =>
  (await handleRouterRequest(new Request(`${env().APP_URL}/api/trpc/${path}`, { headers: { cookie } }))).text();

const answers = [
  { type: "single_choice" as const, choice: 0 },
  { type: "single_choice" as const, choice: 0 },
  { type: "written" as const, text: "It likes the blue box." },
];

beforeAll(async () => {
  const headers = await signedInHeaders(teacherA);
  teacher = createServerCaller(headers);
  teacherId = (await teacher.teacher.session.me()).id;
  assistant = createServerCaller(new Headers({ authorization: `Bearer ${(await teacher.teacher.assistant.createToken()).token}` }));
});

afterAll(closeDb);

describe("a video's tasks behind the student's link", () => {
  it("go out without keys, are answered once, and come back as answered with no verdict", async () => {
    const { id, cookie, student } = await opened("Ответчик");
    expect((await student.student.videos.list()).find((v) => v.id === id)).toMatchObject({ hasTasks: true });
    const before = await raw(cookie, `student.videos.tasks?input=${encodeURIComponent(JSON.stringify({ id }))}`);
    expect(before).toContain("The robot drinks milk.");
    expect(before).not.toMatch(/"answer"|"correct"|"verdict"/);

    await student.student.videos.submitTasks({ id, answers });
    const after = await raw(cookie, `student.videos.tasks?input=${encodeURIComponent(JSON.stringify({ id }))}`);
    expect(JSON.parse(after).result.data.done).toBe(true);
    expect(after).not.toMatch(/"answer"|"correct"|"verdict"|"score"/);
    // One attempt.
    await expect(student.student.videos.submitTasks({ id, answers })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses answers that do not fit the tasks, and a video without tasks has none to answer", async () => {
    const { id, student } = await opened("Неподходящий");
    await expect(student.student.videos.submitTasks({ id, answers: answers.slice(0, 2) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      student.student.videos.submitTasks({ id, answers: [{ type: "gap", gaps: ["x"] }, null, null] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const bare = await opened("Без заданий", false);
    expect(await bare.student.student.videos.tasks({ id: bare.id })).toBeNull();
    expect((await bare.student.student.videos.list()).find((v) => v.id === bare.id)).toMatchObject({ hasTasks: false });
    await expect(bare.student.student.videos.submitTasks({ id: bare.id, answers: [] })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("puts the wrong answer in «Ошибки по темам» as from the video, and the right and written ones nowhere", async () => {
    const { id, studentId, student } = await opened("Ошибающийся");
    await student.student.videos.submitTasks({ id, answers });
    const topic = (await teacher.teacher.students.mistakes({ studentId })).find((t) => t.topic === `robot ${run}`)!;
    expect(topic.mistakes).toEqual([
      { from: "video", title: "Ошибающийся clip", at: expect.any(String), task: "The robot drinks milk.", answer: "True" },
    ]);
  });

  it("is closed once the access ends, the answers kept; another student's are not found", async () => {
    const { id, studentId, student } = await opened("Опоздавший");
    const other = await opened("Посторонний", false);
    await expect(other.student.student.videos.tasks({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.student.student.videos.submitTasks({ id, answers })).rejects.toMatchObject({ code: "NOT_FOUND" });

    await student.student.videos.submitTasks({ id, answers });
    await db().update(gameAccess).set({ until: new Date(Date.now() - MINUTE) }).where(eq(gameAccess.materialId, id));
    await expect(student.student.videos.tasks({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(student.student.videos.submitTasks({ id, answers })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const kept = await db().select({ studentId: videoAnswer.studentId }).from(videoAnswer).where(eq(videoAnswer.materialId, id));
    expect(kept).toEqual([{ studentId }]);
  });
});
