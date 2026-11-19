import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LessonState } from "../../../domain/lesson-state";
import { closeDb } from "../../db/client";
import { env } from "../../env";
import { mp3, pdf } from "../../testing/files";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleTextbookUpload } from "../index";

// The lesson mode (#152): the panel opens the lesson from its plan, the
// stage gets what the lesson shows but never the note, the state is kept with
// the panel's counter so a late save never replaces a newer one, and nothing
// of another teacher's lesson is reachable. The textbook, the track and the
// warm-up are synthetic.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacherHeaders: Headers;
let teacher: ReturnType<typeof createServerCaller>;
let other: ReturnType<typeof createServerCaller>;
let textbookId: string;
let lessonIds: Record<string, string>;
let warmupId: string;
let otherWarmupId: string;

const isoIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function upload(kind: "book" | "track", body: Buffer) {
  const response = await handleTextbookUpload(
    new Request(`${env().APP_URL}/api/files/textbooks?kind=${kind}`, { method: "PUT", headers: teacherHeaders, body: new Uint8Array(body) }),
  );
  return ((await response.json()) as { file: string }).file;
}

/** A student on the textbook with 1.1 passed and a lesson in two days, its plan: the warm-up, then 1.2. */
async function plannedLesson(firstName: string) {
  const { id: studentId } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  await teacher.teacher.prep.setStudentTextbook({ studentId, textbookId, passedLessonId: lessonIds["1.1"]! });
  const { id: lessonId } = await teacher.teacher.schedule.addLesson({ studentId, date: isoIn(2), time: "10:00", durationMinutes: 45, intro: false });
  const plan = {
    stages: [
      { type: "material" as const, materialId: warmupId, minutes: 5 },
      { type: "book" as const, lessonId: lessonIds["1.2"]!, skip: "", minutes: 30 },
    ],
  };
  await teacher.teacher.prep.save({ lessonId, plan, homeworkId: null, revision: "" });
  return lessonId;
}

async function codeOf(call: Promise<unknown>) {
  try {
    await call;
    return "OK";
  } catch (error) {
    return error instanceof TRPCError ? error.code : String(error);
  }
}

beforeAll(async () => {
  teacherHeaders = await signedInHeaders(teacherA);
  teacher = createServerCaller(teacherHeaders);
  other = createServerCaller(await signedInHeaders(teacherB));

  const book = await upload("book", pdf(8));
  const track = await upload("track", mp3());
  ({ id: textbookId } = await teacher.teacher.textbooks.create({
    title: "Lesson mode set",
    level: "A2",
    books: [{ kind: "students_book", name: "book.pdf", file: book }],
    tracks: [{ name: "1-02", file: track }],
  }));
  for (let i = 0; i < 100 && (await teacher.teacher.textbooks.get({ id: textbookId })).books[0]!.status !== "done"; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const lesson = (title: string, from: number, tracks: string[] = []) => ({ title, pages: { students_book: { from, to: from + 1 } }, tracks, words: [] });
  const { revision } = await teacher.teacher.textbooks.structure({ id: textbookId });
  await teacher.teacher.textbooks.saveStructure({
    id: textbookId,
    structure: { units: [{ title: "Unit 1", lessons: [lesson("1.1", 2), lesson("1.2", 4, ["1-02"]), lesson("1.3", 6)] }] },
    revision,
    confirm: true,
  });
  lessonIds = Object.fromEntries(
    (await teacher.teacher.textbooks.structure({ id: textbookId })).structure!.units[0]!.lessons.map((l) => [l.title, l.id!]),
  );
  ({ id: warmupId } = await teacher.teacher.library.addWarmup({
    format: "questions",
    title: "Mode int warm-up",
    level: "A2",
    topic: "mode",
    ageGroup: "younger",
    questions: ["What is your favourite colour?"],
  }));
  ({ id: otherWarmupId } = await other.teacher.library.addWarmup({
    format: "questions",
    title: "Other teacher's warm-up",
    level: "A2",
    topic: "mode",
    ageGroup: "younger",
    questions: ["Not hers"],
  }));
});

afterAll(closeDb);

describe("lesson mode", () => {
  it("opens from the plan: the warm-up first, the book stage at the lesson's first page; the stage gets no note", async () => {
    const lessonId = await plannedLesson("Режим урока");
    const opened = await teacher.teacher.lessonMode.open({ lessonId });
    expect(opened.kept.revision).toBe(0);
    expect(opened.kept.state.current).toBe(0);
    expect(opened.kept.state.stages).toEqual([
      { type: "material", materialId: warmupId, minutes: 5, done: false },
      { type: "book", lessonId: lessonIds["1.2"], skip: "", minutes: 30, done: false, kind: "students_book", pages: { students_book: 4 } },
    ]);
    expect(opened.resources.books).toEqual([expect.objectContaining({ kind: "students_book", pageCount: 8 })]);
    expect(opened.resources.tracks).toEqual([{ name: "1-02", url: expect.stringMatching(/^\/api\/files\/textbooks\//) }]);
    expect(opened.resources.materials.find((m) => m.id === warmupId)).toMatchObject({ kind: "warmup", questions: ["What is your favourite colour?"] });
    // Another teacher's material is not offered.
    expect(opened.resources.materials.some((m) => m.id === otherWarmupId)).toBe(false);

    await teacher.teacher.lessonMode.saveNote({ lessonId, note: "Private to the teacher" });
    expect((await teacher.teacher.lessonMode.open({ lessonId })).note).toBe("Private to the teacher");
    const stage = await teacher.teacher.lessonMode.stage({ lessonId });
    expect(Object.keys(stage).sort()).toEqual(["kept", "lessonId", "resources"]);
    expect(JSON.stringify(stage)).not.toContain("Private to the teacher");
  });

  it("keeps the newer state: a save that arrives late changes nothing", async () => {
    const lessonId = await plannedLesson("Порядок сохранений");
    const { kept } = await teacher.teacher.lessonMode.open({ lessonId });
    const onBook: LessonState = { ...kept.state, current: 1, stages: kept.state.stages.map((s, i) => (i === 0 ? { ...s, done: true } : s)) };
    const onPage5: LessonState = {
      ...onBook,
      stages: onBook.stages.map((s) => (s.type === "book" ? { ...s, pages: { students_book: 5 } } : s)),
      track: { name: "1-02", playing: true, run: 1 },
    };

    // The panel saved revision 2, then revision 1 arrives late: refused, revision 2 stays.
    expect(await teacher.teacher.lessonMode.saveState({ lessonId, revision: 2, state: onPage5 })).toEqual({ saved: true });
    expect(await teacher.teacher.lessonMode.saveState({ lessonId, revision: 1, state: onBook })).toEqual({ saved: false });
    const stage = await teacher.teacher.lessonMode.stage({ lessonId });
    expect(stage.kept.revision).toBe(2);
    expect(stage.kept.state).toEqual(onPage5);
    // Opening again does not start the lesson over.
    expect((await teacher.teacher.lessonMode.open({ lessonId })).kept).toEqual({ revision: 2, state: onPage5 });
  });

  it("refuses a state with a lesson, a material or a track the lesson cannot show", async () => {
    const lessonId = await plannedLesson("Чужие этапы");
    const { kept } = await teacher.teacher.lessonMode.open({ lessonId });
    const withMaterial = (materialId: string): LessonState => ({
      ...kept.state,
      stages: [...kept.state.stages, { type: "material", materialId, minutes: 0, done: false }],
    });
    expect(await codeOf(teacher.teacher.lessonMode.saveState({ lessonId, revision: 1, state: withMaterial(otherWarmupId) }))).toBe("BAD_REQUEST");
    expect(
      await codeOf(
        teacher.teacher.lessonMode.saveState({
          lessonId,
          revision: 1,
          state: { ...kept.state, stages: [{ ...kept.state.stages[1]!, lessonId: "00000000-0000-4000-8000-000000000000" }] },
        }),
      ),
    ).toBe("BAD_REQUEST");
    expect(
      await codeOf(teacher.teacher.lessonMode.saveState({ lessonId, revision: 1, state: { ...kept.state, track: { name: "9-99", playing: true, run: 1 } } })),
    ).toBe("BAD_REQUEST");
    expect(await codeOf(teacher.teacher.lessonMode.saveState({ lessonId, revision: 1, state: { ...kept.state, current: 7 } }))).toBe("BAD_REQUEST");
    // Adding her own warm-up during the lesson is fine.
    expect(await teacher.teacher.lessonMode.saveState({ lessonId, revision: 1, state: withMaterial(warmupId) })).toEqual({ saved: true });
  });

  it("answers another teacher's lesson as a missing one, and leaves it alone", async () => {
    const lessonId = await plannedLesson("Чужой урок");
    const { kept } = await teacher.teacher.lessonMode.open({ lessonId });
    await teacher.teacher.lessonMode.saveNote({ lessonId, note: "Hers" });
    expect(await codeOf(other.teacher.lessonMode.open({ lessonId }))).toBe("NOT_FOUND");
    expect(await codeOf(other.teacher.lessonMode.stage({ lessonId }))).toBe("NOT_FOUND");
    expect(await codeOf(other.teacher.lessonMode.saveState({ lessonId, revision: 9, state: kept.state }))).toBe("NOT_FOUND");
    expect(await codeOf(other.teacher.lessonMode.saveNote({ lessonId, note: "Overwritten" }))).toBe("NOT_FOUND");
    const after = await teacher.teacher.lessonMode.open({ lessonId });
    expect(after.note).toBe("Hers");
    expect(after.kept.revision).toBe(0);
  });
});
