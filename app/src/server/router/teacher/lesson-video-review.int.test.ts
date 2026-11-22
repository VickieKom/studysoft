import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { closeDb, db } from "../../db/client";
import { lesson, lessonPlan } from "../../db/schema";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest } from "../index";

// A video's tasks on the lesson stage (#328): the video stage's confirmed
// tasks with the student's answers from this lesson, right or wrong, keys
// included for the teacher's windows; before the child answers, the tasks
// alone; another lesson's answers never; another teacher's lesson not found.
// The tasks are synthetic.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
const MINUTE = 60_000;
let teacher: ReturnType<typeof createServerCaller>;
let other: ReturnType<typeof createServerCaller>;
let assistant: ReturnType<typeof createServerCaller>;
let teacherId: string;
const run = crypto.randomUUID().slice(0, 8);
const TASKS = {
  version: 1,
  title: "Robot evening",
  tasks: [
    { type: "single_choice", prompt: "The robot goes to bed at nine.", options: ["True", "False"], answer: 0 },
    { type: "single_choice", prompt: "The robot reads a book.", options: ["True", "False"], answer: 1 },
  ],
};

async function studentCaller(studentId: string) {
  const token = (await teacher.teacher.links.student({ studentId })).url.split("#")[1]!;
  const response = await handleRouterRequest(
    new Request(`${env().APP_URL}/api/trpc/links.exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }),
  );
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES.student}=`))!.split(";")[0]!;
  return createServerCaller(new Headers({ cookie }));
}

/** A lesson of the student starting `ago` ms back, its plan the video alone. */
async function lessonWithVideo(studentId: string, videoId: string, ago: number) {
  const [row] = await db().insert(lesson).values({ teacherId, studentId, startsAt: new Date(Date.now() - ago), durationMinutes: 45 }).returning({ id: lesson.id });
  await db().insert(lessonPlan).values({ lessonId: row!.id, teacherId, plan: { stages: [{ type: "material", materialId: videoId, minutes: 10 }] } });
  return row!.id;
}

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  other = createServerCaller(await signedInHeaders(teacherB));
  teacherId = (await teacher.teacher.session.me()).id;
  assistant = createServerCaller(new Headers({ authorization: `Bearer ${(await teacher.teacher.assistant.createToken()).token}` }));
});

afterAll(closeDb);

describe("a video stage", () => {
  it("shows the tasks alone before the child answers, then their answers from this lesson, right or wrong, with the keys", async () => {
    const { id: studentId } = await teacher.teacher.students.create({ firstName: `Разбор ${run}`, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
    const { id: videoId } = await teacher.teacher.library.addVideoLink({ title: `Evening ${run}`, level: "A2", topic: "review", ageGroup: "younger", url: "https://video.example.test/e" });
    await assistant.agent.saveVideoTasksDraft({ videoId, tasks: TASKS });
    await teacher.teacher.library.confirmVideoTasks({ id: videoId, revision: (await teacher.teacher.library.videoTasks({ id: videoId })).draft!.revision });
    const lessonId = await lessonWithVideo(studentId, videoId, 5 * MINUTE);

    const before = await teacher.teacher.lessonMode.videos({ lessonId });
    expect(before).toEqual([
      {
        id: videoId,
        title: `Evening ${run}`,
        answered: false,
        tasks: [
          expect.objectContaining({ index: 0, prompt: "The robot goes to bed at nine.", answer: null, verdict: null, key: "True" }),
          expect.objectContaining({ index: 1, prompt: "The robot reads a book.", answer: null, verdict: null, key: "False" }),
        ],
      },
    ]);

    await teacher.teacher.library.openToStudent({ id: videoId, studentId });
    const student = await studentCaller(studentId);
    await student.student.videos.submitTasks({ id: videoId, answers: [{ type: "single_choice", choice: 0 }, { type: "single_choice", choice: 0 }] });

    const [after] = await teacher.teacher.lessonMode.videos({ lessonId });
    expect(after!.answered).toBe(true);
    expect(after!.tasks.map((t) => [t.answer, t.verdict])).toEqual([
      ["True", true],
      ["True", false],
    ]);

    // Another lesson of the student's with the same video shows none of this lesson's answers.
    const later = await lessonWithVideo(studentId, videoId, -2 * 60 * MINUTE);
    expect((await teacher.teacher.lessonMode.videos({ lessonId: later }))[0]!.answered).toBe(false);

    await expect(other.teacher.lessonMode.videos({ lessonId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
