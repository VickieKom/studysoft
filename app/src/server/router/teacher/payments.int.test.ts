import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, dateIn } from "../../../domain/schedule";
import { LINK_SESSION_COOKIES, type LinkRole, withStudentLocked } from "../../access/links";
import { addPayment, editPayment, removeOldPaymentRevisions } from "../../crm/payments";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "../../db/client";
import { paymentRevision, student } from "../../db/schema";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest } from "../index";

// Prices, payments and the balance (#83); correcting and deleting a payment (#101).

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];

let teacher: ReturnType<typeof createServerCaller>;
let otherTeacher: ReturnType<typeof createServerCaller>;
const base = { lastName: "", level: "A2" as const, timeZone: "Europe/Moscow" as const };
const moscow = (days: number) => addDays(dateIn(new Date(), "Europe/Moscow"), days);

async function newStudent(firstName: string) {
  return (await teacher.teacher.students.create({ ...base, firstName })).id;
}

async function heldLesson(studentId: string, days: number, charged = true) {
  const { id: lessonId } = await teacher.teacher.schedule.addLesson({
    studentId,
    date: moscow(days),
    time: "00:01",
    durationMinutes: 60,
    intro: false,
  });
  await teacher.teacher.schedule.mark({ lessonId, status: "held", charged, unit: "", note: "" });
}

/** A balance with plain spaces: money is written with non-breaking ones. */
const plain = (text: string | null) => text?.replace(/\s/g, " ") ?? null;

function routerRequest(path: string, init: RequestInit = {}) {
  return handleRouterRequest(new Request(`${env().APP_URL}/api/trpc/${path}`, init));
}

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  otherTeacher = createServerCaller(await signedInHeaders(teacherB));
});

afterAll(closeDb);

describe("teacher.payments", () => {
  it("counts a prepaid balance from payments and charged lessons, and warns at one lesson", async () => {
    const studentId = await newStudent("Предоплата");
    expect(await teacher.teacher.payments.get({ studentId })).toMatchObject({ terms: null, balance: null, payments: [] });

    await teacher.teacher.payments.saveTerms({ studentId, format: "prepaid", price: "1500", currency: "RUB", validFrom: moscow(-7) });
    await teacher.teacher.payments.addPayment({ studentId, amount: "6000", paidOn: moscow(0), comment: "Перевод" });
    expect(await teacher.teacher.payments.get({ studentId })).toMatchObject({
      balance: "Осталось 4 урока · 6 000 ₽",
      runningOut: false,
      payments: [expect.objectContaining({ amountMinor: 600_000, comment: "Перевод" })],
    });

    await heldLesson(studentId, -3);
    await heldLesson(studentId, -2, false);
    await heldLesson(studentId, -1);
    // A new price from today: the earlier lessons keep 1 500 ₽.
    await teacher.teacher.payments.saveTerms({ studentId, format: "prepaid", price: "2000", currency: "RUB", validFrom: moscow(0) });
    expect(await teacher.teacher.payments.get({ studentId })).toMatchObject({
      balance: "Осталось 1 урок · 3 000 ₽",
      runningOut: true,
      terms: { priceMinor: 200_000, validFrom: moscow(0) },
    });
  });

  it("shows a postpaid debt only while something is owed, and nothing for a free student", async () => {
    const postpaid = await newStudent("Постоплата");
    await teacher.teacher.payments.saveTerms({ studentId: postpaid, format: "postpaid", price: "30", currency: "USD", validFrom: moscow(-7) });
    await heldLesson(postpaid, -2);
    await heldLesson(postpaid, -1);
    expect((await teacher.teacher.payments.get({ studentId: postpaid })).balance).toBe("Долг 2 урока · 60 $");
    await teacher.teacher.payments.addPayment({ studentId: postpaid, amount: "60", paidOn: moscow(0), comment: "" });
    expect((await teacher.teacher.payments.get({ studentId: postpaid })).balance).toBeNull();

    const free = await newStudent("Бесплатно");
    await teacher.teacher.payments.saveTerms({ studentId: free, format: "free", currency: "RUB", validFrom: moscow(-7) });
    await heldLesson(free, -1);
    expect(await teacher.teacher.payments.get({ studentId: free })).toMatchObject({
      balance: null,
      terms: { format: "free", priceMinor: 0 },
    });
  });

  it("keeps one currency per student once it counts", async () => {
    // Set by mistake and replaced the same day before any payment: allowed.
    const studentId = await newStudent("Валюта");
    await teacher.teacher.payments.saveTerms({ studentId, format: "prepaid", price: "20", currency: "USD", validFrom: moscow(0) });
    await teacher.teacher.payments.saveTerms({ studentId, format: "prepaid", price: "1500", currency: "RUB", validFrom: moscow(0) });
    await teacher.teacher.payments.addPayment({ studentId, amount: "6000", paidOn: moscow(0), comment: "" });
    const before = await teacher.teacher.payments.get({ studentId });

    // After a payment, neither the same day's terms nor new ones may switch it.
    for (const validFrom of [moscow(0), moscow(7)]) {
      await expect(
        teacher.teacher.payments.saveTerms({ studentId, format: "prepaid", price: "20", currency: "USD", validFrom }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    // A new price in the same currency is fine.
    await teacher.teacher.payments.saveTerms({ studentId, format: "prepaid", price: "2000", currency: "RUB", validFrom: moscow(7) });
    expect((await teacher.teacher.payments.get({ studentId })).balance).toBe(before.balance);
    // Terms on another date fix it even without payments.
    const other = await newStudent("Валюта без оплат");
    await teacher.teacher.payments.saveTerms({ studentId: other, format: "postpaid", price: "500", currency: "THB", validFrom: moscow(-7) });
    await expect(
      teacher.teacher.payments.saveTerms({ studentId: other, format: "postpaid", price: "15", currency: "EUR", validFrom: moscow(0) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("checks the currency after a payment being saved at the same moment", async () => {
    const studentId = await newStudent("Валюта в гонке");
    const teacherId = (await teacher.teacher.session.me()).id;
    await teacher.teacher.payments.saveTerms({ studentId, format: "prepaid", price: "1500", currency: "RUB", validFrom: moscow(0) });

    // A payment holds the student's lock and has not committed yet...
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held!: () => void;
    const holding = new Promise<void>((resolve) => (held = resolve));
    const paying = withStudentLocked(db(), teacherId, studentId, async (tx) => {
      await addPayment(tx, teacherId, studentId, { paidOn: moscow(0), amountMinor: 600_000, comment: null });
      held();
      await gate;
    });
    await holding;

    // ...so a switch to dollars waits for it, then sees the payment and is refused.
    let settled = false;
    const switching = teacher.teacher.payments
      .saveTerms({ studentId, format: "prepaid", price: "20", currency: "USD", validFrom: moscow(0) })
      .finally(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(settled).toBe(false);
    release();
    await paying;
    await expect(switching).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("takes amounts with a comma or a point and refuses others", async () => {
    const studentId = await newStudent("Суммы");
    await teacher.teacher.payments.saveTerms({ studentId, format: "prepaid", price: "30,5", currency: "EUR", validFrom: moscow(0) });
    expect((await teacher.teacher.payments.get({ studentId })).terms).toMatchObject({ priceMinor: 3050, currency: "EUR" });
    for (const amount of ["0", "-5", "1.234", "abc"]) {
      await expect(
        teacher.teacher.payments.addPayment({ studentId, amount, paidOn: moscow(0), comment: "" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    await expect(
      teacher.teacher.payments.saveTerms({ studentId, format: "prepaid", currency: "RUB", validFrom: moscow(0) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("keep another teacher out, and never reach the student, the parent or the assistant", async () => {
    const studentId = await newStudent("Закрытые деньги");
    await teacher.teacher.payments.saveTerms({ studentId, format: "prepaid", price: "1731", currency: "RUB", validFrom: moscow(0) });
    await teacher.teacher.payments.addPayment({ studentId, amount: "7731", paidOn: moscow(0), comment: "Комментарий 731" });
    for (const call of [
      () => otherTeacher.teacher.payments.get({ studentId }),
      () => otherTeacher.teacher.payments.addPayment({ studentId, amount: "1", paidOn: moscow(0), comment: "" }),
      () =>
        otherTeacher.teacher.payments.saveTerms({ studentId, format: "free", currency: "RUB", validFrom: moscow(0) }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: "NOT_FOUND" });
    }

    const cookieOf = async (role: LinkRole) => {
      const url = (await teacher.teacher.links[role]({ studentId })).url;
      const response = await routerRequest("links.exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: url.split("#")[1] }),
      });
      return response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES[role]}=`))!.split(";")[0]!;
    };
    const { token } = await teacher.teacher.assistant.createToken();
    const bodies = [
      await (await routerRequest("student.me", { headers: { cookie: await cookieOf("student") } })).text(),
      await (await routerRequest("parent.me", { headers: { cookie: await cookieOf("parent") } })).text(),
      await (
        await routerRequest(`agent.studentContext?input=${encodeURIComponent(JSON.stringify({ studentId }))}`, {
          headers: { authorization: `Bearer ${token}` },
        })
      ).text(),
    ];
    for (const body of bodies) {
      expect(body).toContain('"result"');
      for (const hidden of ["1731", "173100", "7731", "773100", "Комментарий 731"]) expect(body).not.toContain(hidden);
    }
  });

  it("corrects a mistaken payment and deletes a duplicate; the balance follows and the old values are kept inside (#101)", async () => {
    const studentId = await newStudent("Исправление");
    await teacher.teacher.payments.saveTerms({ studentId, format: "prepaid", price: "1500", currency: "RUB", validFrom: moscow(-7) });
    const { id: mistaken } = await teacher.teacher.payments.addPayment({ studentId, amount: "60000", paidOn: moscow(0), comment: "за месяц" });
    const { id: duplicate } = await teacher.teacher.payments.addPayment({ studentId, amount: "6000", paidOn: moscow(0), comment: "" });
    expect(plain((await teacher.teacher.payments.get({ studentId })).balance)).toBe("Осталось 44 урока · 66 000 ₽");

    await teacher.teacher.payments.updatePayment({ id: mistaken, amount: "6000", paidOn: moscow(-1), comment: "за 4 урока" });
    const corrected = await teacher.teacher.payments.get({ studentId });
    expect(plain(corrected.balance)).toBe("Осталось 8 уроков · 12 000 ₽");
    expect(corrected.payments).toContainEqual({ id: mistaken, paidOn: moscow(-1), amountMinor: 600_000, comment: "за 4 урока" });

    await teacher.teacher.payments.deletePayment({ id: duplicate });
    const after = await teacher.teacher.payments.get({ studentId });
    expect(plain(after.balance)).toBe("Осталось 4 урока · 6 000 ₽");
    expect(after.payments.map((p) => p.id)).toEqual([mistaken]);

    const kept = await db()
      .select({ paymentId: paymentRevision.paymentId, amountMinor: paymentRevision.amountMinor, comment: paymentRevision.comment, change: paymentRevision.change })
      .from(paymentRevision)
      .where(eq(paymentRevision.studentId, studentId));
    expect(kept).toEqual(
      expect.arrayContaining([
        { paymentId: mistaken, amountMinor: 6_000_000, comment: "за месяц", change: "edited" },
        { paymentId: duplicate, amountMinor: 600_000, comment: null, change: "deleted" },
      ]),
    );
    expect(kept).toHaveLength(2);

    // A refused amount and a deleted payment change nothing.
    await expect(teacher.teacher.payments.updatePayment({ id: mistaken, amount: "0", paidOn: moscow(0), comment: "" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(teacher.teacher.payments.deletePayment({ id: duplicate })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      teacher.teacher.payments.updatePayment({ id: duplicate, amount: "1", paidOn: moscow(0), comment: "" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(plain((await teacher.teacher.payments.get({ studentId })).balance)).toBe("Осталось 4 урока · 6 000 ₽");
  });

  it("lets another teacher neither correct nor delete a payment: the same not-found as a missing one", async () => {
    const studentId = await newStudent("Чужая оплата");
    await teacher.teacher.payments.saveTerms({ studentId, format: "prepaid", price: "1500", currency: "RUB", validFrom: moscow(0) });
    const { id } = await teacher.teacher.payments.addPayment({ studentId, amount: "6000", paidOn: moscow(0), comment: "" });
    const missing = "00000000-0000-4000-8000-000000000000";
    for (const target of [id, missing]) {
      // An invalid amount too: whose the payment is is checked first, so it tells nothing about another teacher's.
      for (const amount of ["1", "0"]) {
        await expect(
          otherTeacher.teacher.payments.updatePayment({ id: target, amount, paidOn: moscow(0), comment: "" }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      }
      await expect(otherTeacher.teacher.payments.deletePayment({ id: target })).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect((await teacher.teacher.payments.get({ studentId })).payments).toEqual([
      expect.objectContaining({ id, amountMinor: 600_000 }),
    ]);
  });

  it("neither corrects nor deletes a deleted student's payment: the same not-found as a missing one", async () => {
    const studentId = await newStudent("Удалённый с оплатой");
    await teacher.teacher.payments.saveTerms({ studentId, format: "prepaid", price: "1500", currency: "RUB", validFrom: moscow(0) });
    const { id } = await teacher.teacher.payments.addPayment({ studentId, amount: "6000", paidOn: moscow(0), comment: "" });
    await db().update(student).set({ deletedAt: new Date() }).where(eq(student.id, studentId));

    await expect(teacher.teacher.payments.updatePayment({ id, amount: "1", paidOn: moscow(0), comment: "" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(teacher.teacher.payments.deletePayment({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db().select().from(paymentRevision).where(eq(paymentRevision.paymentId, id))).toEqual([]);
  });

  it("keeps the values a correction replaced when another one holds the payment: the second waits for the first", async () => {
    const studentId = await newStudent("Две правки");
    const teacherId = (await teacher.teacher.session.me()).id;
    await teacher.teacher.payments.saveTerms({ studentId, format: "prepaid", price: "1500", currency: "RUB", validFrom: moscow(0) });
    const { id } = await teacher.teacher.payments.addPayment({ studentId, amount: "100", paidOn: moscow(0), comment: "" });

    // A first correction holds the student's lock and has not committed yet...
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held!: () => void;
    const holding = new Promise<void>((resolve) => (held = resolve));
    const first = withStudentLocked(db(), teacherId, studentId, async (tx) => {
      await editPayment(tx, teacherId, studentId, id, { paidOn: moscow(0), amountMinor: 20_000, comment: null });
      held();
      await gate;
    });
    await holding;

    // ...so a second one waits for it, then keeps 200 as the replaced value, not 100.
    let settled = false;
    const second = teacher.teacher.payments
      .updatePayment({ id, amount: "300", paidOn: moscow(0), comment: "" })
      .finally(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(settled).toBe(false);
    release();
    await first;
    await second;

    const kept = await db()
      .select({ amountMinor: paymentRevision.amountMinor })
      .from(paymentRevision)
      .where(and(eq(paymentRevision.paymentId, id), eq(paymentRevision.change, "edited")))
      .orderBy(paymentRevision.createdAt);
    expect(kept.map((k) => k.amountMinor)).toEqual([10_000, 20_000]);
    expect((await teacher.teacher.payments.get({ studentId })).payments).toEqual([expect.objectContaining({ amountMinor: 30_000 })]);
  });

  it("removes the old values after the keeping period, and not before", async () => {
    const studentId = await newStudent("Чистка правок");
    await teacher.teacher.payments.saveTerms({ studentId, format: "prepaid", price: "1500", currency: "RUB", validFrom: moscow(0) });
    const { id } = await teacher.teacher.payments.addPayment({ studentId, amount: "100", paidOn: moscow(0), comment: "" });
    await teacher.teacher.payments.deletePayment({ id });
    const ofThis = () => db().select({ id: paymentRevision.id }).from(paymentRevision).where(eq(paymentRevision.paymentId, id));

    await removeOldPaymentRevisions(db(), new Date(Date.now() + 29 * 86_400_000));
    expect(await ofThis()).toHaveLength(1);
    await removeOldPaymentRevisions(db(), new Date(Date.now() + 31 * 86_400_000));
    expect(await ofThis()).toHaveLength(0);
  });
});
