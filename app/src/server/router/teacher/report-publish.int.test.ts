import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, dateIn } from "../../../domain/schedule";
import { LINK_SESSION_COOKIES } from "../../access/links";
import { closeDb } from "../../db/client";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest } from "../index";

// Publishing a parent's report (#268): «Опубликовать» freezes its numbers and
// shows it on the parent's page with the filled blocks only, never the
// balance; the teacher edits a published report and the parent sees the
// edit; «Снять с публикации» makes it a draft again, refused while the
// student has another draft. The parent sees only their own child's
// published reports. The data is synthetic.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;
let other: ReturnType<typeof createServerCaller>;

const moscow = (days: number) => addDays(dateIn(new Date(), "Europe/Moscow"), days);

async function newStudent(firstName: string) {
  return (await teacher.teacher.students.create({ firstName, lastName: "", level: "A2", timeZone: "Europe/Moscow" })).id;
}

async function linkCaller(studentId: string, role: "student" | "parent") {
  const url = role === "student" ? (await teacher.teacher.links.student({ studentId })).url : (await teacher.teacher.links.parent({ studentId })).url;
  const response = await handleRouterRequest(
    new Request(`${env().APP_URL}/api/trpc/links.exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: url.split("#")[1]! }) }),
  );
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES[role]}=`))!.split(";")[0]!;
  return createServerCaller(new Headers({ cookie }));
}

async function published(studentId: string, text: string) {
  const draft = await teacher.teacher.reports.open({ studentId });
  await teacher.teacher.reports.save({
    reportId: draft.id,
    blocks: [
      { title: "Что получается", text },
      { title: "План", text: "" },
    ],
    showPayments: true,
  });
  await teacher.teacher.reports.publish({ reportId: draft.id });
  return draft.id;
}

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  other = createServerCaller(await signedInHeaders(teacherB));
});

afterAll(closeDb);

describe("publishing a report", () => {
  it("freezes the numbers and shows the filled blocks to the parent, never the balance", async () => {
    const studentId = await newStudent("Отчёт публикуется");
    await teacher.teacher.payments.saveTerms({ studentId, format: "prepaid", price: "1500", currency: "RUB", validFrom: moscow(-7) });
    await teacher.teacher.payments.addPayment({ studentId, amount: "3000", paidOn: moscow(0), comment: "" });
    await teacher.teacher.progress.save({ studentId, date: moscow(-5), previousDate: null, results: { reading: 75 } });
    const parent = await linkCaller(studentId, "parent");
    expect(await parent.parent.reports()).toEqual([]);

    const reportId = await published(studentId, "Читает вслух.");
    await expect(teacher.teacher.reports.publish({ reportId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // A result entered after publishing does not change the published numbers.
    await teacher.teacher.progress.save({ studentId, date: moscow(-1), previousDate: null, results: { reading: 90 } });
    const [shown] = await parent.parent.reports();
    expect(shown).toMatchObject({ id: reportId, blocks: [{ title: "Что получается", text: "Читает вслух." }] });
    expect(shown!.numbers.skills).toEqual([{ skill: "reading", percent: 75, trend: null }]);
    // Ids are random and may hold «1500» or «3000» (#355): they are left out of the check.
    const withoutIds = JSON.stringify(await parent.parent.reports()).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>");
    expect(withoutIds).not.toMatch(/Осталось|1\s?500|3\s?000|showPayments|balance/);
    expect((await teacher.teacher.reports.get({ reportId })).numbers.skills).toEqual([{ skill: "reading", percent: 75, trend: null }]);
    expect((await teacher.teacher.reports.get({ reportId })).status).toBe("published");
  });

  it("lets the teacher edit a published report and take it down; the next draft starts after the last published one", async () => {
    const studentId = await newStudent("Отчёт правится");
    const parent = await linkCaller(studentId, "parent");
    const reportId = await published(studentId, "Было.");
    await teacher.teacher.reports.save({ reportId, blocks: [{ title: "Что получается", text: "Стало." }], showPayments: false });
    expect((await parent.parent.reports())[0]!.blocks).toEqual([{ title: "Что получается", text: "Стало." }]);

    // While another draft is open, taking it down is refused: one draft per student.
    const next = await teacher.teacher.reports.open({ studentId });
    expect(next.id).not.toBe(reportId);
    expect(next.periodFrom).toBe(moscow(0));
    await expect(teacher.teacher.reports.unpublish({ reportId })).rejects.toMatchObject({ code: "CONFLICT" });
    await teacher.teacher.reports.publish({ reportId: next.id });

    await teacher.teacher.reports.unpublish({ reportId });
    expect((await parent.parent.reports()).map((r) => r.id)).toEqual([next.id]);
    expect((await teacher.teacher.reports.open({ studentId })).id).toBe(reportId);
    await expect(teacher.teacher.reports.unpublish({ reportId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("shows a parent only their own child's published reports; the student and another teacher get none", async () => {
    const mine = await newStudent("Отчёт своего");
    const theirs = await newStudent("Отчёт другого");
    const reportId = await published(mine, "Только для своих.");
    await teacher.teacher.reports.open({ studentId: theirs });
    expect(await (await linkCaller(theirs, "parent")).parent.reports()).toEqual([]);
    const student = await linkCaller(mine, "student");
    await expect(student.parent.reports()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(other.teacher.reports.get({ reportId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.teacher.reports.publish({ reportId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.teacher.reports.unpublish({ reportId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.teacher.reports.save({ reportId, blocks: [], showPayments: false })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
