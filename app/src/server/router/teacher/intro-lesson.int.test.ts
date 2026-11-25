import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, dateIn } from "../../../domain/schedule";
import { closeDb, db } from "../../db/client";
import { CANDIDATE_STATUS } from "../../../domain/student";
import { clientRequest, gameResult, homework, lesson, lessonState, student, vocabularyWord } from "../../db/schema";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller } from "../index";

// The intro lesson booked from a request (#338): a hidden card for the child,
// a free intro lesson on it, the request following the lesson's marks, the
// games of the intro's stage and «Итог вводного». Names are synthetic.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;
let other: ReturnType<typeof createServerCaller>;

const today = new Date().toISOString().slice(0, 10);
const run = crypto.randomUUID().slice(0, 8);
const moscow = (days: number) => addDays(dateIn(new Date(), "Europe/Moscow"), days);

async function newRequest(firstName: string) {
  return (await teacher.teacher.requests.create({ firstName, age: 7, schoolYear: "", contact: "", source: "avito", requestedOn: today })).id;
}

const stageOf = async (id: string) => (await teacher.teacher.requests.get({ id })).stage;

/** The hidden card and its intro lessons, as the database has them. */
async function introOf(id: string) {
  const [row] = await db().select({ studentId: clientRequest.studentId }).from(clientRequest).where(eq(clientRequest.id, id));
  const lessons = await db()
    .select({ id: lesson.id, kind: lesson.kind, charged: lesson.charged })
    .from(lesson)
    .where(eq(lesson.studentId, row!.studentId!));
  return { studentId: row!.studentId!, lessons };
}

const settledWithin = (promise: Promise<unknown>, ms: number) =>
  Promise.race([promise.then(() => true, () => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms))]);

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
  other = createServerCaller(await signedInHeaders(teacherB));
});

afterAll(closeDb);

describe("an intro booked from a request", () => {
  it("is a free intro lesson on a hidden card, and the request is «Вводный записан»", async () => {
    const id = await newRequest("Вводная int");
    await teacher.teacher.requests.bookIntro({ id, date: moscow(2), time: "12:00", durationMinutes: 45 });
    expect(await stageOf(id)).toBe("intro_booked");

    const { studentId, lessons } = await introOf(id);
    expect(lessons).toEqual([{ id: expect.any(String), kind: "intro", charged: null }]);
    // On the week with the child's name.
    const week = await teacher.teacher.schedule.upcoming();
    expect(week.lessons.find((l) => l.id === lessons[0]!.id)).toMatchObject({ studentName: "Вводная int" });

    // The card is hidden: in no list of students, and no card of its own.
    const all = [...(await teacher.teacher.students.list()), ...(await teacher.teacher.students.list({ status: "finished" }))];
    expect(all.map((s) => s.id)).not.toContain(studentId);
    expect(await codeOf(teacher.teacher.students.get({ id: studentId }))).toBe("NOT_FOUND");

    // A second one is refused while the first is on the schedule, the time named (product owner, 2026-11-24).
    await expect(teacher.teacher.requests.bookIntro({ id, date: moscow(3), time: "12:00", durationMinutes: 45 })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("Вводный уже записан на"),
    });
    expect((await introOf(id)).lessons).toHaveLength(1);

    // Cancelled, it can be booked again, on the same card.
    await teacher.teacher.schedule.cancel({ lessonId: lessons[0]!.id, charged: false });
    await teacher.teacher.requests.bookIntro({ id, date: moscow(3), time: "12:00", durationMinutes: 45 });
    const again = await introOf(id);
    expect(again.studentId).toBe(studentId);
    expect(again.lessons).toHaveLength(2);
    expect(await stageOf(id)).toBe("intro_booked");
  });

  it("is booked from «Заявка» only", async () => {
    const id = await newRequest("Стадийная int");
    for (const stage of ["intro_booked", "intro_held", "offer_sent"] as const) {
      await teacher.teacher.requests.move({ id, stage });
      expect(await codeOf(teacher.teacher.requests.bookIntro({ id, date: moscow(2), time: "12:00", durationMinutes: 45 }))).toBe("CONFLICT");
    }
    await teacher.teacher.requests.move({ id, stage: "declined", reason: "expensive", comment: "" });
    expect(await codeOf(teacher.teacher.requests.bookIntro({ id, date: moscow(2), time: "12:00", durationMinutes: 45 }))).toBe("CONFLICT");
    expect(await stageOf(id)).toBe("declined");

    // Moved back to «Заявка» by hand while its intro is on the schedule: still one intro.
    const scheduled = await newRequest("Вернувшаяся int");
    await teacher.teacher.requests.bookIntro({ id: scheduled, date: moscow(2), time: "12:00", durationMinutes: 45 });
    await teacher.teacher.requests.move({ id: scheduled, stage: "request" });
    expect(await codeOf(teacher.teacher.requests.bookIntro({ id: scheduled, date: moscow(3), time: "12:00", durationMinutes: 45 }))).toBe("CONFLICT");
    expect((await introOf(scheduled)).lessons).toHaveLength(1);
  });

  it("charges nothing, held or cancelled, even when the teacher ticks «Списать»", async () => {
    const id = await newRequest("Бесплатная int");
    await teacher.teacher.requests.bookIntro({ id, date: moscow(-1), time: "10:00", durationMinutes: 60 });
    const { lessons } = await introOf(id);
    const lessonId = lessons[0]!.id;

    await teacher.teacher.schedule.mark({ lessonId, status: "held", charged: true, unit: "", note: "" });
    expect((await introOf(id)).lessons[0]!.charged).toBe(false);

    const later = await newRequest("Бесплатная отменённая int");
    await teacher.teacher.requests.bookIntro({ id: later, date: moscow(4), time: "10:00", durationMinutes: 60 });
    const laterId = (await introOf(later)).lessons[0]!.id;
    await teacher.teacher.schedule.cancel({ lessonId: laterId, charged: true });
    expect((await introOf(later)).lessons[0]!.charged).toBe(false);
  });

  it("follows the lesson: held — «Вводный проведён», missed or cancelled — «Заявка», put back — «Вводный записан»", async () => {
    const id = await newRequest("Следящая int");
    await teacher.teacher.requests.bookIntro({ id, date: moscow(-1), time: "10:00", durationMinutes: 60 });
    const lessonId = (await introOf(id)).lessons[0]!.id;

    await teacher.teacher.schedule.mark({ lessonId, status: "held", charged: false, unit: "", note: "" });
    expect(await stageOf(id)).toBe("intro_held");
    await teacher.teacher.schedule.mark({ lessonId, status: "missed", charged: false, unit: "", note: "" });
    expect(await stageOf(id)).toBe("request");

    const cancelled = await newRequest("Отменённая int");
    await teacher.teacher.requests.bookIntro({ id: cancelled, date: moscow(5), time: "10:00", durationMinutes: 60 });
    const future = (await introOf(cancelled)).lessons[0]!.id;
    await teacher.teacher.schedule.cancel({ lessonId: future, charged: false });
    expect(await stageOf(cancelled)).toBe("request");
    await teacher.teacher.schedule.restore({ lessonId: future });
    expect(await stageOf(cancelled)).toBe("intro_booked");

    // From all the card's intros: a cancelled one put back beside a new one, then cancelled again, leaves the new one booked.
    const twice = await newRequest("Дважды int");
    await teacher.teacher.requests.bookIntro({ id: twice, date: moscow(5), time: "11:00", durationMinutes: 60 });
    const first = (await introOf(twice)).lessons[0]!.id;
    await teacher.teacher.schedule.cancel({ lessonId: first, charged: false });
    await teacher.teacher.requests.bookIntro({ id: twice, date: moscow(6), time: "11:00", durationMinutes: 60 });
    await teacher.teacher.schedule.restore({ lessonId: first });
    await teacher.teacher.schedule.cancel({ lessonId: first, charged: false });
    expect(await stageOf(twice)).toBe("intro_booked");

    // A request moved on by hand stays where the teacher put it.
    await teacher.teacher.requests.move({ id: cancelled, stage: "offer_sent" });
    await teacher.teacher.schedule.cancel({ lessonId: future, charged: false });
    expect(await stageOf(cancelled)).toBe("offer_sent");
  });

  it("keeps the games of the intro's stage and «Итог вводного» on the request", async () => {
    const id = await newRequest("Игровая int");
    await teacher.teacher.requests.bookIntro({ id, date: moscow(1), time: "10:00", durationMinutes: 45 });
    const lessonId = (await introOf(id)).lessons[0]!.id;
    expect(await teacher.teacher.requests.introGames({ id })).toEqual([]);

    const html = `<!doctype html><html><body><h1>Intro int game</h1></body></html>`;
    const { id: materialId } = await teacher.teacher.library.addGame({ title: `Intro int game ${run}`, level: "A1", topic: "", ageGroup: "younger", html });
    const result = {
      type: "studysoft.game-result",
      version: 1,
      answers: [
        { task: "Two and two?", answer: "four", correct: true, topic: "numbers" },
        { task: "The sky is…", answer: "green", correct: false, topic: "colours" },
      ],
    };
    await teacher.teacher.lessonMode.saveGameResult({ lessonId, materialId, result });
    expect(await teacher.teacher.requests.introGames({ id })).toEqual([
      {
        id: expect.any(String),
        title: `Intro int game ${run}`,
        playedAt: expect.any(Date),
        answers: [
          { task: "Two and two?", answer: "four", correct: true },
          { task: "The sky is…", answer: "green", correct: false },
        ],
      },
    ]);

    await teacher.teacher.requests.saveIntroOutcome({ id, level: "A1", notes: "  Понимает на слух " });
    expect(await teacher.teacher.requests.get({ id })).toMatchObject({ introLevel: "A1", introNotes: "Понимает на слух" });
  });

  it("is another teacher's to no one, and its card goes with the request's personal data", async () => {
    const id = await newRequest("Чужая вводная int");
    expect(await codeOf(other.teacher.requests.bookIntro({ id, date: moscow(1), time: "10:00", durationMinutes: 45 }))).toBe("NOT_FOUND");
    expect(await codeOf(other.teacher.requests.introGames({ id }))).toBe("NOT_FOUND");
    expect(await codeOf(other.teacher.requests.saveIntroOutcome({ id, level: "A2", notes: "" }))).toBe("NOT_FOUND");
    expect(await codeOf(teacher.teacher.requests.bookIntro({ id, date: moscow(1), time: "25:00", durationMinutes: 45 }))).toBe("BAD_REQUEST");
    expect(await codeOf(teacher.teacher.requests.bookIntro({ id, date: moscow(1), time: "10:00", durationMinutes: 30 }))).toBe("BAD_REQUEST");

    await teacher.teacher.requests.bookIntro({ id, date: moscow(0), time: "00:00", durationMinutes: 45 });
    await teacher.teacher.requests.saveIntroOutcome({ id, level: "A2", notes: "Стираемая заметка" });
    const { studentId, lessons } = await introOf(id);
    const lessonId = lessons[0]!.id;

    // All the intro leaves on the card: the lesson mode's state and note, a game's result, a homework drafted, the finish's note and words.
    await teacher.teacher.lessonMode.open({ lessonId });
    await teacher.teacher.lessonMode.saveNote({ lessonId, note: "Стираемая заметка урока" });
    const { id: materialId } = await teacher.teacher.library.addGame({ title: `Erased int game ${run}`, level: "A1", topic: "", ageGroup: "younger", html: "<!doctype html><title>g</title>" });
    await teacher.teacher.lessonMode.saveGameResult({
      lessonId,
      materialId,
      result: { type: "studysoft.game-result", version: 1, answers: [{ task: "Erased task", answer: "erased", correct: true, topic: "numbers" }] },
    });
    const teacherId = (await teacher.teacher.session.me()).id;
    await db().insert(homework).values({ teacherId, studentId, title: "Стираемая домашка", document: { title: "Стираемая домашка", tasks: [] } });
    const form = await teacher.teacher.lessonMode.finishForm({ lessonId });
    expect(
      await teacher.teacher.lessonMode.finish({ lessonId, charged: false, note: "Стираемая заметка урока", bookLessonId: null, homework: form.homework ? { id: form.homework.id, revision: form.homework.revision, dueDate: form.homework.dueDate } : null, words: [{ word: "erasedword", translation: "" }] }),
    ).toMatchObject({ requestId: id });
    expect(await stageOf(id)).toBe("intro_held");

    await teacher.teacher.requests.remove({ id });

    const [card] = await db().select().from(student).where(eq(student.id, studentId));
    expect(card!.deletedAt).not.toBeNull();
    expect(JSON.stringify(card)).not.toContain("Чужая вводная int");
    const [row] = await db().select().from(clientRequest).where(eq(clientRequest.id, id));
    expect(JSON.stringify(row)).not.toMatch(/Чужая вводная int|Стираемая заметка/);
    // Nothing of the child is left anywhere (product owner, 2026-11-24).
    expect(await db().select().from(lesson).where(eq(lesson.studentId, studentId))).toEqual([]);
    expect(await db().select().from(lessonState).where(eq(lessonState.lessonId, lessonId))).toEqual([]);
    expect(await db().select().from(gameResult).where(eq(gameResult.studentId, studentId))).toEqual([]);
    expect(await db().select().from(vocabularyWord).where(eq(vocabularyWord.studentId, studentId))).toEqual([]);
    expect(await db().select().from(homework).where(eq(homework.studentId, studentId))).toEqual([]);
  });

  it("is not the assistant's: no intro among the upcoming lessons, and its plan is not found", async () => {
    const assistant = createServerCaller(new Headers({ authorization: `Bearer ${(await teacher.teacher.assistant.createToken()).token}` }));
    const id = await newRequest("Без ассистента int");
    await teacher.teacher.requests.bookIntro({ id, date: moscow(1), time: "15:00", durationMinutes: 45 });
    const { studentId, lessons } = await introOf(id);
    const lessonId = lessons[0]!.id;

    expect((await assistant.agent.upcomingLessons({})).map((l) => l.id)).not.toContain(lessonId);
    expect(await codeOf(assistant.agent.upcomingLessons({ studentId }))).toBe("OK");
    expect(await assistant.agent.upcomingLessons({ studentId })).toEqual([]);
    expect(await codeOf(assistant.agent.lessonPlan({ lessonId }))).toBe("NOT_FOUND");
    expect(await codeOf(assistant.agent.lessonMaterials({ lessonId }))).toBe("NOT_FOUND");
    expect(await codeOf(assistant.agent.saveLessonPlan({ lessonId, plan: { stages: [] } }))).toBe("NOT_FOUND");
    // The teacher prepares it, and the prep leads back to the request instead of a card.
    expect((await teacher.teacher.prep.get({ lessonId })).requestId).toBe(id);
    // No ordinary status for the hidden card through the card's form.
    expect(await codeOf(teacher.teacher.students.update({ id: studentId, firstName: "Не карточка", lastName: "", level: "A1", timeZone: "Europe/Moscow", status: "active" }))).toBe("NOT_FOUND");
  });
});

describe("two bookings at once", () => {
  it("wait for each other on the request: the second sees the first's intro and is refused", async () => {
    const id = await newRequest("Одновременная int");
    const teacherId = (await teacher.teacher.session.me()).id;
    let second: Promise<unknown> | undefined;
    await db().transaction(async (tx) => {
      // The first booking's lock on the request, held open.
      await tx.select({ id: clientRequest.id }).from(clientRequest).where(eq(clientRequest.id, id)).for("update");
      second = teacher.teacher.requests.bookIntro({ id, date: moscow(2), time: "09:00", durationMinutes: 45 });
      expect(await settledWithin(second, 300)).toBe(false);
      // The first booking's writes: the card, its intro, the stage.
      const [card] = await tx.insert(student).values({ teacherId, firstName: "Одновременная int", timeZone: "Europe/Moscow", status: CANDIDATE_STATUS }).returning({ id: student.id });
      await tx.insert(lesson).values({ teacherId, studentId: card!.id, startsAt: new Date(Date.now() + 86_400_000), durationMinutes: 45, kind: "intro" });
      await tx.update(clientRequest).set({ studentId: card!.id, stage: "intro_booked" }).where(eq(clientRequest.id, id));
    });
    expect(await codeOf(second!)).toBe("CONFLICT");
    expect((await introOf(id)).lessons).toHaveLength(1);
  });
});
