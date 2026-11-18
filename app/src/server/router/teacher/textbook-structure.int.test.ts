import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "../../db/client";
import { env } from "../../env";
import { mp3, pdf } from "../../testing/files";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest, handleTextbookUpload } from "../index";

// A textbook's units and lessons (#150): the assistant saves a draft, the
// teacher corrects and confirms it or enters one by hand; lessons use only
// the confirmed structure. The textbook is synthetic: six pages that say
// their number and two tracks of silence.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacherHeaders: Headers;
let teacher: ReturnType<typeof createServerCaller>;
let other: ReturnType<typeof createServerCaller>;
let assistant: ReturnType<typeof createServerCaller>;
let otherAssistant: ReturnType<typeof createServerCaller>;
let assistantToken: string;

async function upload(kind: string, bytes: Buffer) {
  const response = await handleTextbookUpload(
    new Request(`${env().APP_URL}/api/files/textbooks?kind=${kind}`, { method: "PUT", headers: teacherHeaders, body: new Uint8Array(bytes) }),
  );
  return ((await response.json()) as { file: string }).file;
}

/** A six-page student's book with tracks 1-01 and 1-02, rendered; returns its id and the book's id. */
async function newTextbook(title: string) {
  const { id } = await teacher.teacher.textbooks.create({
    title,
    level: "A2",
    books: [{ kind: "students_book", name: "book.pdf", file: await upload("book", pdf(6)) }],
    tracks: [
      { name: "1-01", file: await upload("track", mp3()) },
      { name: "1-02", file: await upload("track", mp3()) },
    ],
  });
  for (let i = 0; i < 100; i++) {
    const found = await teacher.teacher.textbooks.get({ id });
    if (found.books.every((b) => b.status === "done")) return { id, bookId: found.books[0]!.id };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("not rendered");
}

const lesson = (title: string, from: number, to: number, track: string) => ({
  title,
  pages: { students_book: { from, to } },
  tracks: [track],
  words: ["kite", "lamp", "nest"],
});
const structure = { units: [{ title: "Unit 1", lessons: [lesson("1.1", 1, 2, "1-01"), lesson("1.2", 3, 4, "1-02")] }] };

beforeAll(async () => {
  teacherHeaders = await signedInHeaders(teacherA);
  teacher = createServerCaller(teacherHeaders);
  other = createServerCaller(await signedInHeaders(teacherB));
  assistantToken = (await teacher.teacher.assistant.createToken()).token;
  assistant = createServerCaller(new Headers({ authorization: `Bearer ${assistantToken}` }));
  otherAssistant = createServerCaller(new Headers({ authorization: `Bearer ${(await other.teacher.assistant.createToken()).token}` }));
});

afterAll(closeDb);

describe("a textbook's structure", () => {
  it("is the assistant's draft until the teacher corrects and confirms it; a lesson then has its pages, track and words", async () => {
    const { id } = await newTextbook("Assistant set");
    expect(await assistant.agent.saveTextbookStructure({ textbookId: id, structure })).toEqual({ status: "draft" });
    const view = await teacher.teacher.textbooks.structure({ id });
    expect(view).toMatchObject({ structure: null, draftBy: "assistant", draft: { units: [{ title: "Unit 1" }] } });
    // The platform gives the lessons their ids.
    const [first, second] = view.draft!.units[0]!.lessons;
    expect(first!.id).toMatch(/^[0-9a-f-]{36}$/);
    // Lessons use only a confirmed structure.
    await expect(teacher.teacher.textbooks.lesson({ textbookId: id, lessonId: second!.id! })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const corrected = structuredClone(view.draft!);
    corrected.units[0]!.lessons[1]!.pages.students_book = { from: 3, to: 5 };
    await teacher.teacher.textbooks.saveStructure({ id, structure: corrected, revision: view.revision, confirm: true });
    const confirmed = await teacher.teacher.textbooks.structure({ id });
    expect(confirmed).toMatchObject({ draft: null, draftBy: null });
    expect(confirmed.structure!.units[0]!.lessons.map((l) => l.id)).toEqual([first!.id, second!.id]);

    const shown = await teacher.teacher.textbooks.lesson({ textbookId: id, lessonId: second!.id! });
    expect(shown).toMatchObject({ title: "1.2", unit: "Unit 1", pages: [{ kind: "students_book", from: 3, to: 5 }], words: ["kite", "lamp", "nest"] });
    expect(shown.tracks.map((t) => t.name)).toEqual(["1-02"]);
    expect((await assistant.agent.listTextbooks()).find((t) => t.id === id)).toMatchObject({ confirmed: true, draftBy: null, tracks: ["1-01", "1-02"] });
  });

  it("is checked against the textbook: a range past the book, a track it lacks, an empty title; nothing is saved", async () => {
    const { id } = await newTextbook("Checked set");
    const cases: [unknown, RegExp][] = [
      [{ units: [{ title: "U", lessons: [lesson("1", 5, 7, "1-01")] }] }, /юнит 1, урок 1: в Student's Book 6 страниц, а урок доходит до 7/],
      [{ units: [{ title: "U", lessons: [lesson("1", 1, 1, "9-99")] }] }, /юнит 1, урок 1: трека «9-99» нет в учебнике/],
      [{ units: [{ title: "U", lessons: [{ ...lesson("1", 1, 1, "1-01"), pages: { workbook: { from: 1, to: 1 } } }] }] }, /Workbook нет в учебнике/],
      [{ units: [{ title: " ", lessons: [lesson("1", 1, 1, "1-01")] }] }, /юнит 1/],
      [{ units: [{ title: "U", lessons: [lesson("1", 3, 2, "1-01")] }] }, /первая страница больше последней/],
    ];
    for (const [bad, message] of cases) {
      await expect(assistant.agent.saveTextbookStructure({ textbookId: id, structure: bad })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringMatching(message),
      });
    }
    expect(await teacher.teacher.textbooks.structure({ id })).toMatchObject({ structure: null, draft: null });
  });

  it("is entered by hand, kept as the teacher's draft, which the assistant then cannot replace", async () => {
    const { id } = await newTextbook("Hand set");
    const { revision } = await teacher.teacher.textbooks.structure({ id });
    const byHand = { units: [{ title: "Starter", lessons: [{ title: "Starter", pages: { students_book: { from: 1, to: 2 } }, tracks: [], words: [] }] }] };
    await teacher.teacher.textbooks.saveStructure({ id, structure: byHand, revision, confirm: false });
    expect(await teacher.teacher.textbooks.structure({ id })).toMatchObject({ draftBy: "teacher", structure: null });
    await expect(assistant.agent.saveTextbookStructure({ textbookId: id, structure })).rejects.toMatchObject({ code: "CONFLICT" });

    const draft = await teacher.teacher.textbooks.structure({ id });
    await teacher.teacher.textbooks.saveStructure({ id, structure: draft.draft, revision: draft.revision, confirm: true });
    const { structure: confirmed } = await teacher.teacher.textbooks.structure({ id });
    const shown = await teacher.teacher.textbooks.lesson({ textbookId: id, lessonId: confirmed!.units[0]!.lessons[0]!.id! });
    expect(shown.pages).toEqual([expect.objectContaining({ from: 1, to: 2 })]);
    // Confirmed, the assistant may propose again.
    expect(await assistant.agent.saveTextbookStructure({ textbookId: id, structure })).toEqual({ status: "draft" });
  });

  it("refuses the teacher's save when the draft changed since her form loaded it", async () => {
    const { id } = await newTextbook("Raced set");
    const loaded = await teacher.teacher.textbooks.structure({ id });
    // The assistant saves a draft after the teacher's form loaded.
    await assistant.agent.saveTextbookStructure({ textbookId: id, structure });
    for (const confirm of [true, false]) {
      await expect(
        teacher.teacher.textbooks.saveStructure({ id, structure, revision: loaded.revision, confirm }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    }
    expect(await teacher.teacher.textbooks.structure({ id })).toMatchObject({ draftBy: "assistant", structure: null });
  });

  it("lets the assistant read the pages' text and images, never confirm, and never reach another teacher's textbook", async () => {
    const { id, bookId } = await newTextbook("Read set");
    const text = await assistant.agent.textbookText({ bookId, from: 2, to: 3 });
    expect(text.map((p) => p.page)).toEqual([2, 3]);
    expect(text[0]!.text).toContain("Page 2");
    const image = await assistant.agent.textbookPage({ bookId, page: 1 });
    expect(image.contentType).toBe("image/jpeg");
    expect([...Buffer.from(image.base64, "base64").subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    await expect(assistant.agent.textbookText({ bookId, from: 1, to: 21 })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // No agent procedure confirms: the same answer as one that does not exist.
    const call = (procedure: string) =>
      handleRouterRequest(
        new Request(`${env().APP_URL}/api/trpc/${procedure}`, {
          method: "POST",
          headers: { authorization: `Bearer ${assistantToken}`, "content-type": "application/json" },
          body: JSON.stringify({ textbookId: id }),
        }),
      );
    expect((await call("agent.confirmTextbookStructure")).status).toBe((await call("agent.noSuchProcedure")).status);
    // The assistant's token does not open the teacher's procedure.
    await expect(assistant.teacher.textbooks.saveStructure({ id, structure, revision: "", confirm: true })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });

    // Another teacher's assistant and the other teacher: not found.
    for (const call of [
      () => otherAssistant.agent.saveTextbookStructure({ textbookId: id, structure }),
      () => otherAssistant.agent.textbookText({ bookId, from: 1, to: 1 }),
      () => otherAssistant.agent.textbookPage({ bookId, page: 1 }),
      () => otherAssistant.agent.textbookStructure({ textbookId: id }),
      () => other.teacher.textbooks.structure({ id }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect((await otherAssistant.agent.listTextbooks()).map((t) => t.id)).not.toContain(id);
  });
});
