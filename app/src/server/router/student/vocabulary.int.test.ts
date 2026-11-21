import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { closeDb } from "../../db/client";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest } from "../index";

// The student's words (#236): corrected, deleted and added by hand on the
// card; seen by the student behind their link, their own only. The words are
// synthetic.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;
let other: ReturnType<typeof createServerCaller>;

async function newStudent(firstName: string) {
  const { id: studentId } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  const token = (await teacher.teacher.links.student({ studentId })).url.split("#")[1]!;
  const response = await handleRouterRequest(
    new Request(`${env().APP_URL}/api/trpc/links.exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }),
  );
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES.student}=`))!.split(";")[0]!;
  return { studentId, student: createServerCaller(new Headers({ cookie })) };
}

const word = (value: string, translation = "", example = "") => ({ word: value, translation, example });

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  other = createServerCaller(await signedInHeaders(teacherB));
});

afterAll(closeDb);

describe("the student's words", () => {
  it("are added, corrected and deleted on the card, and the student sees them as they are", async () => {
    const { studentId, student } = await newStudent("Слова на карточке");
    await teacher.teacher.students.addWord({ studentId, ...word("  lantern  ") });
    await teacher.teacher.students.addWord({ studentId, ...word("teapot", "чайник", "The teapot is hot.") });
    const added = await teacher.teacher.students.vocabulary({ studentId });
    expect(added.map((w) => w.word)).toEqual(["teapot", "lantern"]);
    // Trimmed; an empty translation or example is none.
    expect(added[1]).toMatchObject({ word: "lantern", translation: null, example: null });
    expect(await student.student.vocabulary.words()).toEqual([
      { id: added[0]!.id, word: "teapot", translation: "чайник", example: "The teapot is hot." },
      { id: added[1]!.id, word: "lantern", translation: null, example: null },
    ]);

    await teacher.teacher.students.updateWord({ studentId, id: added[0]!.id, ...word("teapot", "заварочный чайник", "") });
    await teacher.teacher.students.deleteWord({ studentId, id: added[1]!.id });
    expect(await student.student.vocabulary.words()).toEqual([{ id: added[0]!.id, word: "teapot", translation: "заварочный чайник", example: null }]);
  });

  it("refuses the same word twice whatever its case, by hand or by a rename; an empty word is refused", async () => {
    const { studentId } = await newStudent("Повтор слова");
    await teacher.teacher.students.addWord({ studentId, ...word("Pebble") });
    await teacher.teacher.students.addWord({ studentId, ...word("stone") });
    await expect(teacher.teacher.students.addWord({ studentId, ...word("pebble") })).rejects.toMatchObject({ code: "CONFLICT" });
    const stone = (await teacher.teacher.students.vocabulary({ studentId })).find((w) => w.word === "stone")!;
    await expect(teacher.teacher.students.updateWord({ studentId, id: stone.id, ...word("PEBBLE") })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(teacher.teacher.students.addWord({ studentId, ...word("   ") })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await teacher.teacher.students.vocabulary({ studentId })).map((w) => w.word).sort()).toEqual(["Pebble", "stone"]);
  });

  it("never reach another student, another teacher, or the student's own teacher procedures", async () => {
    const mine = await newStudent("Свои слова");
    const theirs = await newStudent("Чужие слова");
    await teacher.teacher.students.addWord({ studentId: mine.studentId, ...word("compass", "компас") });
    await teacher.teacher.students.addWord({ studentId: theirs.studentId, ...word("anchor", "якорь") });
    expect((await theirs.student.student.vocabulary.words()).map((w) => w.word)).toEqual(["anchor"]);

    const [compass] = await teacher.teacher.students.vocabulary({ studentId: mine.studentId });
    // A word addressed with another student of the same teacher is not found, and stays.
    await expect(teacher.teacher.students.updateWord({ studentId: theirs.studentId, id: compass!.id, ...word("x") })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(teacher.teacher.students.deleteWord({ studentId: theirs.studentId, id: compass!.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const call of [
      () => other.teacher.students.vocabulary({ studentId: mine.studentId }),
      () => other.teacher.students.addWord({ studentId: mine.studentId, ...word("x") }),
      () => other.teacher.students.updateWord({ studentId: mine.studentId, id: compass!.id, ...word("x") }),
      () => other.teacher.students.deleteWord({ studentId: mine.studentId, id: compass!.id }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await expect(mine.student.teacher.students.addWord({ studentId: mine.studentId, ...word("x") })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(await mine.student.student.vocabulary.words()).toEqual([{ id: compass!.id, word: "compass", translation: "компас", example: null }]);
  });
});
