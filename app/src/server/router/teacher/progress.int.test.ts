import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { closeDb, db } from "../../db/client";
import { homework, student, vocabularyWord } from "../../db/schema";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest } from "../index";

// «Прогресс» (#255): results by skill entered by hand — a date replaces its
// own results, a changed date moves them — and the dashboard's totals: the
// homework submitted of those due, the words learnt. The teacher's only.
// The data is synthetic.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;
let other: ReturnType<typeof createServerCaller>;

async function newStudent(firstName: string) {
  const { id: studentId } = await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" });
  return studentId;
}

async function studentSession(studentId: string, role: "student" | "parent") {
  const url = role === "student" ? (await teacher.teacher.links.student({ studentId })).url : (await teacher.teacher.links.parent({ studentId })).url;
  const response = await handleRouterRequest(
    new Request(`${env().APP_URL}/api/trpc/links.exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: url.split("#")[1]! }) }),
  );
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES[role]}=`))!.split(";")[0]!;
  return createServerCaller(new Headers({ cookie }));
}

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  other = createServerCaller(await signedInHeaders(teacherB));
});

afterAll(closeDb);

describe("«Прогресс»", () => {
  it("keeps the results of a date as the form has them, moves them with a changed date, and deletes a date", async () => {
    const studentId = await newStudent("Результаты по навыкам");
    await teacher.teacher.progress.save({ studentId, date: "2026-10-15", previousDate: null, results: { reading: 50, listening: 60 } });
    await teacher.teacher.progress.save({ studentId, date: "2026-11-15", previousDate: null, results: { reading: 70 } });
    // The same date again replaces it: listening left out is gone.
    await teacher.teacher.progress.save({ studentId, date: "2026-10-15", previousDate: null, results: { reading: 55 } });
    expect((await teacher.teacher.progress.get({ studentId })).results).toEqual([
      { skill: "reading", percent: 55, measuredOn: "2026-10-15" },
      { skill: "reading", percent: 70, measuredOn: "2026-11-15" },
    ]);
    // A changed date moves the results.
    await teacher.teacher.progress.save({ studentId, date: "2026-11-20", previousDate: "2026-11-15", results: { reading: 72, grammar: 80 } });
    expect((await teacher.teacher.progress.get({ studentId })).results.map((r) => r.measuredOn)).toEqual(["2026-10-15", "2026-11-20", "2026-11-20"]);
    await teacher.teacher.progress.delete({ studentId, date: "2026-10-15" });
    expect((await teacher.teacher.progress.get({ studentId })).results).toHaveLength(2);

    for (const results of [{}, { reading: 101 }, { reading: -1 }, { reading: 50.5 }]) {
      await expect(teacher.teacher.progress.save({ studentId, date: "2026-12-01", previousDate: null, results })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });

  it("counts the homework submitted of those due and the words learnt", async () => {
    const studentId = await newStudent("Итоги прогресса");
    const [{ teacherId }] = (await db().select({ teacherId: student.teacherId }).from(student).where(eq(student.id, studentId))) as [{ teacherId: string }];
    const doc = { version: 1, title: "x", tasks: [{ type: "written", prompt: "x" }] };
    for (const status of ["submitted", "submitted", "missed", "draft", "published"]) {
      await db().insert(homework).values({ teacherId, studentId, title: `Итоги ${status}`, document: doc, status });
    }
    for (const word of ["owl", "fox", "elk"]) await teacher.teacher.students.addWord({ studentId, word, translation: "x", example: "" });
    await db().update(vocabularyWord).set({ trainStep: 5 }).where(eq(vocabularyWord.word, "owl"));
    expect(await teacher.teacher.progress.get({ studentId })).toMatchObject({
      results: [],
      homework: { submitted: 2, due: 3 },
      textbook: null,
      words: { total: 3, learnt: 1 },
    });
  });

  it("is the teacher's only: another teacher, the student and the parent get none of it", async () => {
    const studentId = await newStudent("Чужой прогресс");
    await teacher.teacher.progress.save({ studentId, date: "2026-11-15", previousDate: null, results: { speaking: 64 } });
    for (const call of [
      () => other.teacher.progress.get({ studentId }),
      () => other.teacher.progress.save({ studentId, date: "2026-11-15", previousDate: null, results: { speaking: 1 } }),
      () => other.teacher.progress.delete({ studentId, date: "2026-11-15" }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    const asStudent = await studentSession(studentId, "student");
    const parent = await studentSession(studentId, "parent");
    await expect(asStudent.teacher.progress.get({ studentId })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(parent.teacher.progress.get({ studentId })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const seen = JSON.stringify([await asStudent.student.me(), await asStudent.student.homework.current(), await asStudent.student.vocabulary.words(), await parent.parent.me()]);
    expect(seen).not.toContain("64");
    expect((await teacher.teacher.progress.get({ studentId })).results).toEqual([{ skill: "speaking", percent: 64, measuredOn: "2026-11-15" }]);
  });
});
