import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "../../db/client";
import { teacher as teacherTable, textbook } from "../../db/schema";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller } from "../index";

// The lesson prep's materials (#293): each game says whether it is made for
// the lesson's student (#292) and its textbook lesson (#291), for the order
// «Добавить из библиотеки» offers them in. The textbook and games are
// synthetic.

const [teacherA] = seedTeachers as [(typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;

const run = crypto.randomUUID().slice(0, 8);
const html = (title: string) => `<!doctype html><html><body><h1>${title}</h1></body></html>`;
const tags = (title: string) => ({ title, level: "A2" as const, topic: "", ageGroup: "younger" as const });
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
});

afterAll(closeDb);

describe("the lesson prep's games", () => {
  it("say which are made for the lesson's student and which textbook lesson each is for", async () => {
    const [{ teacherId }] = (await db().select({ teacherId: teacherTable.id }).from(teacherTable).where(eq(teacherTable.email, teacherA.email))) as [{ teacherId: string }];
    const lessonId = crypto.randomUUID();
    const [book] = await db()
      .insert(textbook)
      .values({ teacherId, title: `Prep ${run}`, level: "A2", structure: { units: [{ title: "Unit 1", lessons: [{ id: lessonId, title: "1.1", pages: {}, tracks: [], words: [] }] }] } })
      .returning({ id: textbook.id });
    const { id: studentId } = await teacher.teacher.students.create({ firstName: `Подготовка ${run}`, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
    const { id: other } = await teacher.teacher.students.create({ firstName: `Другой ${run}`, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
    const mine = (await teacher.teacher.library.addGame({ ...tags(`Для ученика ${run}`), html: html("x"), studentIds: [studentId] })).id;
    const linked = (await teacher.teacher.library.addGame({ ...tags(`К уроку ${run}`), html: html("x"), textbookId: book!.id, textbookLessonId: lessonId })).id;
    const theirs = (await teacher.teacher.library.addGame({ ...tags(`Для другого ${run}`), html: html("x"), studentIds: [other] })).id;
    const { id: lesson } = await teacher.teacher.schedule.addLesson({ studentId, date: tomorrow(), time: "10:00", durationMinutes: 45, intro: false });

    const { materials } = await teacher.teacher.prep.get({ lessonId: lesson });
    const byId = Object.fromEntries(materials.map((m) => [m.id, { forStudent: m.forStudent, textbookLessonId: m.textbookLessonId }]));
    expect(byId[mine]).toEqual({ forStudent: true, textbookLessonId: null });
    expect(byId[linked]).toEqual({ forStudent: false, textbookLessonId: lessonId });
    expect(byId[theirs]).toEqual({ forStudent: false, textbookLessonId: null });
  });
});
