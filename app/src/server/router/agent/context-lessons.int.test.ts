import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, dateIn } from "../../../domain/schedule";
import { LINK_SESSION_COOKIES, type LinkRole } from "../../access/links";
import { CONTEXT_LESSONS } from "../../crm/lesson-history";
import { closeDb } from "../../db/client";
import { env } from "../../env";
import { pdf } from "../../testing/files";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest, handleTextbookUpload } from "../index";

// The latest past lessons in the student context (#424): held and missed,
// newest first, never cancelled; the plan's stages with their titles, the
// note, the words; only for this teacher's assistant, never for the student
// or the parent. The textbook, the game and the notes are synthetic.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacherHeaders: Headers;
let teacher: ReturnType<typeof createServerCaller>;
let assistant: ReturnType<typeof createServerCaller>;
let otherAssistant: ReturnType<typeof createServerCaller>;
let assistantToken: string;
let textbookId: string;
let lessons: { id: string; title: string }[];
let gameId: string;

const moscow = (days: number) => addDays(dateIn(new Date(), "Europe/Moscow"), days);

async function newStudent(firstName: string) {
  const { id: studentId } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  await teacher.teacher.prep.setStudentTextbook({ studentId, textbookId, passedLessonId: lessons[0]!.id });
  return studentId;
}

const addLesson = async (studentId: string, days: number) =>
  (await teacher.teacher.schedule.addLesson({ studentId, date: moscow(days), time: "10:00", durationMinutes: 45, intro: false })).id;

const book = (title: string, skip = "") => ({ type: "book" as const, lessonId: lessons.find((l) => l.title === title)!.id, skip, minutes: 20 });

function routerRequest(path: string, init: RequestInit = {}) {
  return handleRouterRequest(new Request(`${env().APP_URL}/api/trpc/${path}`, init));
}

beforeAll(async () => {
  teacherHeaders = await signedInHeaders(teacherA);
  teacher = createServerCaller(teacherHeaders);
  const other = createServerCaller(await signedInHeaders(teacherB));
  assistantToken = (await teacher.teacher.assistant.createToken()).token;
  assistant = createServerCaller(new Headers({ authorization: `Bearer ${assistantToken}` }));
  otherAssistant = createServerCaller(new Headers({ authorization: `Bearer ${(await other.teacher.assistant.createToken()).token}` }));

  const response = await handleTextbookUpload(
    new Request(`${env().APP_URL}/api/files/textbooks?kind=book`, { method: "PUT", headers: teacherHeaders, body: new Uint8Array(pdf(6)) }),
  );
  const file = ((await response.json()) as { file: string }).file;
  ({ id: textbookId } = await teacher.teacher.textbooks.create({
    title: "History set",
    level: "A2",
    books: [{ kind: "students_book", name: "book.pdf", file }],
    tracks: [],
  }));
  for (let i = 0; i < 100 && (await teacher.teacher.textbooks.get({ id: textbookId })).books[0]!.status !== "done"; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const lesson = (title: string, from: number) => ({ title, pages: { students_book: { from, to: from + 1 } }, tracks: [], words: [] });
  const { revision } = await teacher.teacher.textbooks.structure({ id: textbookId });
  await teacher.teacher.textbooks.saveStructure({
    id: textbookId,
    structure: { units: [{ title: "Unit 1", lessons: [lesson("1.1", 1), lesson("1.2", 3), lesson("1.3", 5)] }] },
    revision,
    confirm: true,
  });
  lessons = (await teacher.teacher.textbooks.structure({ id: textbookId })).structure!.units[0]!.lessons.map((l) => ({ id: l.id!, title: l.title }));
  ({ id: gameId } = await teacher.teacher.library.addGame({
    title: "History int game",
    level: "A2",
    topic: "history",
    ageGroup: "younger",
    html: "<!doctype html><title>g</title><h1>g</h1>",
  }));
});

afterAll(closeDb);

describe("agent.studentContext: recent lessons", () => {
  it("lists the held and missed lessons, newest first, with the plan's stages and the note; a cancelled one is left out", async () => {
    const studentId = await newStudent("История уроков");
    const planned = await addLesson(studentId, -3);
    await teacher.teacher.prep.save({
      lessonId: planned,
      plan: { stages: [{ type: "material", materialId: gameId, minutes: 5 }, book("1.2", "3")] },
      homeworkId: null,
      revision: "",
    });
    await teacher.teacher.schedule.mark({ lessonId: planned, status: "held", charged: true, unit: "Unit 1 · 1.2", note: "Путалась в was/were" });
    const cancelled = await addLesson(studentId, -2);
    await teacher.teacher.schedule.cancel({ lessonId: cancelled, charged: false });
    const missed = await addLesson(studentId, -1);
    await teacher.teacher.schedule.mark({ lessonId: missed, status: "missed", charged: false, unit: "", note: "" });
    // Not yet marked: not a past lesson either.
    await addLesson(studentId, 0);

    const { recentLessons } = await assistant.agent.studentContext({ studentId });
    expect(recentLessons).toEqual([
      { date: expect.any(String), status: "missed", intro: false, bookLesson: null, stages: [], note: null, words: [] },
      {
        date: expect.any(String),
        status: "held",
        intro: false,
        bookLesson: "Unit 1 · 1.2",
        stages: [
          { kind: "game", title: "History int game" },
          { kind: "book", title: "Unit 1 · 1.2", skip: "3" },
        ],
        note: "Путалась в was/were",
        words: [],
      },
    ]);
  });

  it("takes the panel's note when the lesson was marked without one", async () => {
    const studentId = await newStudent("Заметка с пульта");
    const lessonId = await addLesson(studentId, -1);
    await teacher.teacher.lessonMode.open({ lessonId });
    await teacher.teacher.lessonMode.saveNote({ lessonId, note: "Не успели упражнение 4" });
    await teacher.teacher.schedule.mark({ lessonId, status: "held", charged: true, unit: "", note: "" });
    expect((await assistant.agent.studentContext({ studentId })).recentLessons[0]).toMatchObject({ note: "Не успели упражнение 4" });
  });

  it(`carries the ${CONTEXT_LESSONS} latest only`, async () => {
    const studentId = await newStudent("Много уроков");
    for (let day = -7; day <= -1; day++) {
      const lessonId = await addLesson(studentId, day);
      await teacher.teacher.schedule.mark({ lessonId, status: "held", charged: true, unit: `day ${day}`, note: "" });
    }
    const { recentLessons } = await assistant.agent.studentContext({ studentId });
    expect(recentLessons.map((l) => l.bookLesson)).toEqual(["day -1", "day -2", "day -3", "day -4", "day -5"]);
  });

  it("keeps another teacher's assistant, the student and the parent away from the lessons and their notes", async () => {
    const studentId = await newStudent("Закрытые уроки");
    const lessonId = await addLesson(studentId, -1);
    await teacher.teacher.schedule.mark({ lessonId, status: "held", charged: true, unit: "Unit 9 · 424", note: "Заметка урока 424" });

    await expect(otherAssistant.agent.studentContext({ studentId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(otherAssistant.agent.studentContext({ studentId: crypto.randomUUID() })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const cookieOf = async (role: LinkRole) => {
      const url = (await teacher.teacher.links[role]({ studentId })).url;
      const response = await routerRequest("links.exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: url.split("#")[1] }),
      });
      return response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES[role]}=`))!.split(";")[0]!;
    };
    for (const [role, procedure] of [
      ["student", "student.me"],
      ["parent", "parent.me"],
    ] as const) {
      const body = await (await routerRequest(procedure, { headers: { cookie: await cookieOf(role) } })).text();
      expect(body).toContain('"result"');
      expect(body).not.toContain("Заметка урока 424");
      expect(body).not.toContain("Unit 9 · 424");
    }
    expect(JSON.stringify(await assistant.agent.studentContext({ studentId }))).toContain("Заметка урока 424");
  });
});
