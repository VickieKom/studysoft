import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { closeDb } from "../../db/client";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest } from "../index";

// The assistant's translations and examples for the student's words (#237):
// drafts beside what is confirmed, which the student never sees; the teacher
// confirms them as her page showed them. The words are synthetic.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;
let other: ReturnType<typeof createServerCaller>;
let assistant: ReturnType<typeof createServerCaller>;
let otherAssistant: ReturnType<typeof createServerCaller>;

async function newStudent(firstName: string, words: Record<string, string>) {
  const { id: studentId } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  for (const [word, translation] of Object.entries(words)) await teacher.teacher.students.addWord({ studentId, word, translation, example: "" });
  const token = (await teacher.teacher.links.student({ studentId })).url.split("#")[1]!;
  const response = await handleRouterRequest(
    new Request(`${env().APP_URL}/api/trpc/links.exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }),
  );
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES.student}=`))!.split(";")[0]!;
  const ids = Object.fromEntries((await assistant.agent.studentWords({ studentId })).map((w) => [w.word, w.id]));
  return { studentId, ids, student: createServerCaller(new Headers({ cookie })) };
}

const card = async (studentId: string, word: string) => (await teacher.teacher.students.vocabulary({ studentId })).find((w) => w.word === word)!;

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  other = createServerCaller(await signedInHeaders(teacherB));
  assistant = createServerCaller(new Headers({ authorization: `Bearer ${(await teacher.teacher.assistant.createToken()).token}` }));
  otherAssistant = createServerCaller(new Headers({ authorization: `Bearer ${(await other.teacher.assistant.createToken()).token}` }));
});

afterAll(closeDb);

describe("the assistant's word drafts", () => {
  it("stay beside a confirmed translation, unseen by the student, until the teacher confirms them", async () => {
    const { studentId, ids, student } = await newStudent("Черновики слов", { lantern: "", compass: "компас" });
    await assistant.agent.saveWordDrafts({
      studentId,
      words: [
        { wordId: ids.lantern!, translation: "фонарь", example: "The lantern is bright." },
        { wordId: ids.compass!, translation: "компас для похода", example: "" },
      ],
    });
    // The assistant reads its own drafts back; the card shows them; the student sees only what is confirmed.
    expect((await assistant.agent.studentWords({ studentId })).find((w) => w.word === "compass")).toMatchObject({
      translation: "компас",
      draft: { translation: "компас для похода", example: null },
    });
    expect(await card(studentId, "lantern")).toMatchObject({ translation: null, draft: { translation: "фонарь", example: "The lantern is bright." } });
    expect(JSON.stringify(await student.student.vocabulary.words())).not.toMatch(/фонарь|для похода|bright/);

    const compass = await card(studentId, "compass");
    await teacher.teacher.students.confirmWordDrafts({ studentId, words: [{ id: compass.id, ...compass.draft! }] });
    // An empty part of the draft keeps what was confirmed.
    expect(await card(studentId, "compass")).toMatchObject({ translation: "компас для похода", example: null, draft: null });
    expect(await card(studentId, "lantern")).toMatchObject({ draft: { translation: "фонарь" } });
    expect((await student.student.vocabulary.words()).find((w) => w.word === "compass")!.translation).toBe("компас для похода");
  });

  it("refuses a confirm from a page older than the assistant's draft, and confirms nothing of it", async () => {
    const { studentId, ids } = await newStudent("Устаревший черновик", { pebble: "", hammock: "" });
    await assistant.agent.saveWordDrafts({ studentId, words: [{ wordId: ids.pebble!, translation: "камень", example: "" }, { wordId: ids.hammock!, translation: "гамак", example: "" }] });
    // The teacher's page reads the drafts.
    const shown = (await teacher.teacher.students.vocabulary({ studentId })).filter((w) => w.draft);
    // The assistant replaces one meanwhile.
    await assistant.agent.saveWordDrafts({ studentId, words: [{ wordId: ids.pebble!, translation: "камешек", example: "" }] });
    // «Подтвердить все» from the old page: refused, neither confirmed.
    await expect(
      teacher.teacher.students.confirmWordDrafts({ studentId, words: shown.map((w) => ({ id: w.id, ...w.draft! })) }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await card(studentId, "pebble")).toMatchObject({ translation: null, draft: { translation: "камешек" } });
    expect(await card(studentId, "hammock")).toMatchObject({ translation: null, draft: { translation: "гамак" } });
  });

  it("never reach another teacher's student or a word of another student; nothing is saved", async () => {
    const mine = await newStudent("Мои черновики", { anchor: "" });
    const theirs = await newStudent("Соседние черновики", { kettle: "" });
    // A word of another student of the same teacher, in one save with a word of this one: nothing is saved.
    await expect(
      assistant.agent.saveWordDrafts({
        studentId: mine.studentId,
        words: [
          { wordId: mine.ids.anchor!, translation: "якорь", example: "" },
          { wordId: theirs.ids.kettle!, translation: "чайник", example: "" },
        ],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await card(mine.studentId, "anchor")).draft).toBeNull();
    expect((await card(theirs.studentId, "kettle")).draft).toBeNull();
    for (const call of [
      () => otherAssistant.agent.studentWords({ studentId: mine.studentId }),
      () => otherAssistant.agent.saveWordDrafts({ studentId: mine.studentId, words: [{ wordId: mine.ids.anchor!, translation: "x", example: "" }] }),
      () => other.teacher.students.confirmWordDrafts({ studentId: mine.studentId, words: [{ id: mine.ids.anchor!, translation: "x", example: null }] }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    // The assistant's token does not open the teacher's confirm.
    await expect(assistant.teacher.students.confirmWordDrafts({ studentId: mine.studentId, words: [{ id: mine.ids.anchor!, translation: null, example: null }] })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
