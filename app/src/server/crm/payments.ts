// Prices and payments of a student (#83). Teacher procedures only: payments,
// prices and the balance never reach a student, a parent or the assistant
// (architecture 6.3, AGENTS.md rule 4).
import { and, asc, desc, eq, isNull, lt } from "drizzle-orm";
import type { Currency, PaymentFormat, Terms } from "../../domain/payments";
import type { Database } from "../db/client";
import { payment, paymentRevision, priceTerms, student } from "../db/schema";

/** The student's terms over time, oldest first. */
export async function listTerms(db: Pick<Database, "select">, teacherId: string, studentId: string): Promise<Terms[]> {
  const rows = await db
    .select({
      format: priceTerms.format,
      priceMinor: priceTerms.priceMinor,
      currency: priceTerms.currency,
      validFrom: priceTerms.validFrom,
    })
    .from(priceTerms)
    .where(and(eq(priceTerms.teacherId, teacherId), eq(priceTerms.studentId, studentId)))
    .orderBy(asc(priceTerms.validFrom));
  return rows.map((r) => ({ ...r, format: r.format as PaymentFormat, currency: r.currency as Currency }));
}

/**
 * Sets the terms from a date; terms already starting that day are replaced.
 * The composite key refuses a new row for another teacher's student, but not
 * an update of an existing one, so the update is limited to this teacher's.
 */
export async function saveTerms(db: Pick<Database, "insert">, teacherId: string, studentId: string, terms: Terms): Promise<void> {
  await db
    .insert(priceTerms)
    .values({ teacherId, studentId, ...terms })
    .onConflictDoUpdate({
      target: [priceTerms.studentId, priceTerms.validFrom],
      set: { format: terms.format, priceMinor: terms.priceMinor, currency: terms.currency },
      setWhere: eq(priceTerms.teacherId, teacherId),
    });
}

export type Payment = { id: string; paidOn: string; amountMinor: number; comment: string | null };

/** The student's payments, newest first. */
export async function listPayments(db: Pick<Database, "select">, teacherId: string, studentId: string): Promise<Payment[]> {
  return db
    .select({ id: payment.id, paidOn: payment.paidOn, amountMinor: payment.amountMinor, comment: payment.comment })
    .from(payment)
    .where(and(eq(payment.teacherId, teacherId), eq(payment.studentId, studentId)))
    .orderBy(desc(payment.paidOn), desc(payment.createdAt));
}

/** Records a payment received from a student of this teacher. */
export async function addPayment(
  db: Pick<Database, "insert">,
  teacherId: string,
  studentId: string,
  input: { paidOn: string; amountMinor: number; comment: string | null },
): Promise<string> {
  const [row] = await db
    .insert(payment)
    .values({ teacherId, studentId, ...input })
    .returning({ id: payment.id });
  if (!row) throw new Error("addPayment: insert returned no row");
  return row.id;
}

/**
 * Whose a payment of this teacher is, or null: the student to lock before
 * changing it. A deleted student's payment is the same as a missing one, as
 * everywhere else a student is read.
 */
export async function paymentStudent(db: Pick<Database, "select">, teacherId: string, paymentId: string): Promise<string | null> {
  const [row] = await db
    .select({ studentId: payment.studentId })
    .from(payment)
    .innerJoin(student, and(eq(student.id, payment.studentId), eq(student.teacherId, payment.teacherId), isNull(student.deletedAt)))
    .where(and(eq(payment.id, paymentId), eq(payment.teacherId, teacherId)));
  return row?.studentId ?? null;
}

/**
 * Keeps a payment's current values as a revision, then edits or deletes it
 * (#101). Runs in the caller's transaction, under the student's lock; the
 * payment's row is locked too, so the values kept are the ones replaced.
 * False when this teacher's student has no such payment.
 */
async function revise(
  tx: Pick<Database, "select" | "insert" | "update" | "delete">,
  teacherId: string,
  studentId: string,
  paymentId: string,
  apply: (own: ReturnType<typeof and>) => Promise<unknown>,
  change: "edited" | "deleted",
): Promise<boolean> {
  const own = and(eq(payment.id, paymentId), eq(payment.teacherId, teacherId), eq(payment.studentId, studentId));
  const [old] = await tx
    .select({ paidOn: payment.paidOn, amountMinor: payment.amountMinor, comment: payment.comment })
    .from(payment)
    .where(own)
    .for("update");
  if (!old) return false;
  await tx.insert(paymentRevision).values({ paymentId, teacherId, studentId, ...old, change });
  await apply(own);
  return true;
}

/** Changes a payment's amount, date and comment, keeping the old values for about a month. */
export async function editPayment(
  tx: Pick<Database, "select" | "insert" | "update" | "delete">,
  teacherId: string,
  studentId: string,
  paymentId: string,
  input: { paidOn: string; amountMinor: number; comment: string | null },
): Promise<boolean> {
  return revise(tx, teacherId, studentId, paymentId, (own) => tx.update(payment).set(input).where(own), "edited");
}

/** Deletes a payment, keeping its values for about a month. */
export async function deletePayment(
  tx: Pick<Database, "select" | "insert" | "update" | "delete">,
  teacherId: string,
  studentId: string,
  paymentId: string,
): Promise<boolean> {
  return revise(tx, teacherId, studentId, paymentId, (own) => tx.delete(payment).where(own), "deleted");
}

/** How long a payment's old values are kept (#101). */
export const REVISION_DAYS = 30;

/** Removes the revisions older than the keeping period; returns how many went. */
export async function removeOldPaymentRevisions(db: Pick<Database, "delete">, now: Date = new Date()): Promise<number> {
  const before = new Date(now.getTime() - REVISION_DAYS * 86_400_000);
  const rows = await db.delete(paymentRevision).where(lt(paymentRevision.createdAt, before)).returning({ id: paymentRevision.id });
  return rows.length;
}
