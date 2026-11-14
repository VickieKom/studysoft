import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  balanceShown,
  CURRENCIES,
  CURRENCY_IDS,
  computeBalance,
  PAYMENT_FORMAT_IDS,
  termsOn,
} from "../../../domain/payments";
import { dateIn } from "../../../domain/schedule";
import { withStudentLocked } from "../../access/links";
import { addPayment, listPayments, listTerms, saveTerms } from "../../crm/payments";
import { findStudent } from "../../crm/students";
import type { Database } from "../../db/client";
import { chargedLessonDates } from "../../schedule/schedule";
import { router, teacherProcedure } from "../core/trpc";

// Prices, payments and the balance (#83). Teacher only; nothing here reaches
// a student, a parent or the assistant.

const notFound = () => new TRPCError({ code: "NOT_FOUND" });
/** «1500», «30.5», «30,50»: an amount in major units, at most two decimals. */
const amount = z
  .string()
  .trim()
  .regex(/^\d{1,9}([.,]\d{1,2})?$/)
  .transform((value) => Math.round(Number(value.replace(",", ".")) * 100));

async function studentToday(db: Database, teacherId: string, studentId: string): Promise<string> {
  const card = await findStudent(db, teacherId, studentId);
  if (!card) throw notFound();
  return dateIn(new Date(), card.timeZone);
}

export const paymentsRouter = router({
  /** The «Оплаты» block of the card: current terms, payments and what to say about the balance. */
  get: teacherProcedure
    .input(z.object({ studentId: z.uuid() }))
    .output(
      z
        .object({
          today: z.iso.date(),
          terms: z
            .object({
              format: z.enum(PAYMENT_FORMAT_IDS),
              priceMinor: z.number().int(),
              currency: z.enum(CURRENCY_IDS),
              validFrom: z.iso.date(),
            })
            .strict()
            .nullable(),
          payments: z.array(
            z
              .object({ id: z.uuid(), paidOn: z.iso.date(), amountMinor: z.number().int(), comment: z.string().nullable() })
              .strict(),
          ),
          balance: z.string().nullable(),
          runningOut: z.boolean(),
        })
        .strict(),
    )
    .query(async ({ ctx, input }) => {
      const today = await studentToday(ctx.db, ctx.teacherId, input.studentId);
      const history = await listTerms(ctx.db, ctx.teacherId, input.studentId);
      const payments = await listPayments(ctx.db, ctx.teacherId, input.studentId);
      const charged = await chargedLessonDates(ctx.db, ctx.teacherId, input.studentId);
      const terms = termsOn(history, today) ?? history.at(-1) ?? null;
      const balance = computeBalance(history, payments, charged, today);
      return {
        today,
        terms,
        payments,
        balance: balanceShown(balance, terms?.format ?? null),
        runningOut: balance?.runningOut ?? false,
      };
    }),

  /** «Сохранить условия»: format, price and currency from a date; earlier lessons keep their price. */
  saveTerms: teacherProcedure
    .input(
      z.object({
        studentId: z.uuid(),
        format: z.enum(PAYMENT_FORMAT_IDS),
        price: amount.optional(),
        currency: z.enum(CURRENCY_IDS),
        validFrom: z.iso.date(),
      }),
    )
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      await studentToday(ctx.db, ctx.teacherId, input.studentId);
      if (input.format !== "free" && !input.price) throw new TRPCError({ code: "BAD_REQUEST", message: "Укажите цену урока" });
      // One currency per student (#83): payments carry no currency of their
      // own, so changing it would recount every past payment in the new one.
      // It is fixed by terms on another date, or by the replaced terms once a
      // payment exists. Checked and written under the student's lock, which
      // addPayment takes too, so two saves cannot both find it unset.
      await withStudentLocked(ctx.db, ctx.teacherId, input.studentId, async (tx) => {
        const history = await listTerms(tx, ctx.teacherId, input.studentId);
        const fixed =
          history.find((t) => t.validFrom !== input.validFrom)?.currency ??
          ((await listPayments(tx, ctx.teacherId, input.studentId)).length > 0 ? history[0]?.currency : undefined);
        if (fixed && fixed !== input.currency) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Цены и оплаты ученика ведутся в одной валюте: ${CURRENCIES.find((c) => c.id === fixed)?.symbol ?? fixed}`,
          });
        }
        await saveTerms(tx, ctx.teacherId, input.studentId, {
          format: input.format,
          priceMinor: input.format === "free" ? 0 : (input.price ?? 0),
          currency: input.currency,
          validFrom: input.validFrom,
        });
      });
      return { ok: true as const };
    }),

  /** «Добавить оплату»: a payment received from the student. */
  addPayment: teacherProcedure
    .input(
      z.object({
        studentId: z.uuid(),
        amount,
        paidOn: z.iso.date(),
        comment: z
          .string()
          .max(1000)
          .transform((value) => (value.trim() === "" ? null : value)),
      }),
    )
    .output(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await studentToday(ctx.db, ctx.teacherId, input.studentId);
      if (input.amount <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Сумма должна быть больше нуля" });
      // Under the student's lock, so a terms save checking for payments waits for it.
      const id = await withStudentLocked(ctx.db, ctx.teacherId, input.studentId, (tx) =>
        addPayment(tx, ctx.teacherId, input.studentId, {
          paidOn: input.paidOn,
          amountMinor: input.amount,
          comment: input.comment,
        }),
      );
      return { id };
    }),
});
