import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "../../db/client";
import { teacher as teacherTable, textbook } from "../../db/schema";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller } from "../index";

// A game linked to a lesson of the teacher's textbook (#291): checked
// against the confirmed structure; found by «Учебник» and «Урок»; named on
// its page; removed by an edit; read as no link once the lesson leaves the
// structure. Another teacher's textbook is not found. The assistant links
// its draft the same way and reads each lesson's games. The textbooks and
// games are synthetic.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;
let other: ReturnType<typeof createServerCaller>;
let assistant: ReturnType<typeof createServerCaller>;

const run = crypto.randomUUID().slice(0, 8);
const html = (title: string) => `<!doctype html><html><body><h1>${title}</h1></body></html>`;
const tags = (title: string) => ({ title, level: "A2" as const, topic: "", ageGroup: "younger" as const });
const lesson = (id: string, title: string) => ({ id, title, pages: {}, tracks: [], words: [] });

/** A textbook of this teacher with a confirmed Unit 1 of lessons 1.1 and 1.2; returns its id and the lessons' ids. */
async function textbookFor(as: (typeof seedTeachers)[number], title: string) {
  // The teacher by her seed address: no student is made here, other tests count hers.
  const [{ teacherId }] = (await db().select({ teacherId: teacherTable.id }).from(teacherTable).where(eq(teacherTable.email, as.email))) as [{ teacherId: string }];
  const [first, second] = [crypto.randomUUID(), crypto.randomUUID()];
  const [book] = await db()
    .insert(textbook)
    .values({ teacherId, title, level: "A2", structure: { units: [{ title: "Unit 1", lessons: [lesson(first, "1.1"), lesson(second, "1.2")] }] } })
    .returning({ id: textbook.id });
  return { textbookId: book!.id, first, second };
}

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  other = createServerCaller(await signedInHeaders(teacherB));
  assistant = createServerCaller(new Headers({ authorization: `Bearer ${(await teacher.teacher.assistant.createToken()).token}` }));
});

afterAll(closeDb);

describe("a game linked to a textbook lesson", () => {
  it("is checked against the structure, found by it, named, removed by an edit, and unlinked when the lesson goes", async () => {
    const { textbookId, first, second } = await textbookFor(teacherA, `Linked ${run}`);
    expect((await teacher.teacher.library.textbooks()).find((t) => t.id === textbookId)!.lessons).toEqual([
      { id: first, label: "Unit 1 · 1.1" },
      { id: second, label: "Unit 1 · 1.2" },
    ]);

    await expect(
      teacher.teacher.library.addGame({ ...tags("Нет урока"), html: html("x"), textbookId, textbookLessonId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Такого урока нет в учебнике" });
    await expect(teacher.teacher.library.addGame({ ...tags("Без урока"), html: html("x"), textbookId })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const { id } = await teacher.teacher.library.addGame({ ...tags("Игра урока"), html: html("Игра урока"), textbookId, textbookLessonId: second });
    expect((await teacher.teacher.library.get({ id })).textbookLesson).toEqual({ textbookId, lessonId: second, label: `Linked ${run} · Unit 1 · 1.2` });
    expect((await teacher.teacher.library.list({ textbookId, lessonId: second })).materials.map((m) => m.id)).toEqual([id]);
    expect((await teacher.teacher.library.list({ textbookId, lessonId: first })).materials).toEqual([]);
    expect((await teacher.teacher.library.list({ textbookId })).materials.map((m) => m.id)).toEqual([id]);

    // An edit without the link keeps it; «Без учебника» removes it.
    await teacher.teacher.library.update({ id, ...tags("Игра урока") });
    expect((await teacher.teacher.library.get({ id })).textbookLesson?.lessonId).toBe(second);
    await teacher.teacher.library.update({ id, ...tags("Игра урока"), textbookId: null, textbookLessonId: null });
    expect((await teacher.teacher.library.get({ id })).textbookLesson).toBeNull();

    // Linked again, then the lesson leaves the structure: no link, the game stays.
    await teacher.teacher.library.update({ id, ...tags("Игра урока"), textbookId, textbookLessonId: second });
    await db()
      .update(textbook)
      .set({ structure: { units: [{ title: "Unit 1", lessons: [lesson(first, "1.1")] }] } })
      .where(eq(textbook.id, textbookId));
    expect((await teacher.teacher.library.get({ id })).textbookLesson).toBeNull();
  });

  it("is refused for another teacher's textbook", async () => {
    const theirs = await textbookFor(teacherB, `Theirs ${run}`);
    await expect(
      teacher.teacher.library.addGame({ ...tags("Чужой учебник"), html: html("x"), textbookId: theirs.textbookId, textbookLessonId: theirs.first }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await teacher.teacher.library.textbooks()).map((t) => t.id)).not.toContain(theirs.textbookId);
  });

  it("is saved by the assistant for its draft, which the structure lists under the lesson", async () => {
    const { textbookId, first } = await textbookFor(teacherA, `Assistant ${run}`);
    const { id } = await assistant.agent.saveGameDraft({ ...tags("Черновик урока"), html: html("Черновик урока"), textbookId, textbookLessonId: first });
    const { structure } = await assistant.agent.textbookStructure({ textbookId });
    const [one, two] = structure!.units[0]!.lessons;
    expect(one!.games).toEqual([{ id, title: "Черновик урока" }]);
    expect(two!.games).toEqual([]);
    await expect(
      assistant.agent.saveGameDraft({ ...tags("Мимо"), html: html("x"), textbookId, textbookLessonId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Такого урока нет в учебнике" });
  });
});
