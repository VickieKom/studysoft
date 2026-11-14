// Prices and payments of a student (#83). Teacher procedures only: payments,
// prices and the balance never reach a student, a parent or the assistant
// (architecture 6.3, AGENTS.md rule 4).
import { and, asc, desc, eq } from "drizzle-orm";
import type { Currency, PaymentFormat, Terms } from "../../domain/payments";
import type { Database } from "../db/client";
import { payment, priceTerms } from "../db/schema";

/** The student's terms over time, oldest first. */
export async function listTerms(db: Database, teacherId: string, studentId: string): Promise<Terms[]> {
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
export async function saveTerms(db: Database, teacherId: string, studentId: string, terms: Terms): Promise<void> {
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
export async function listPayments(db: Database, teacherId: string, studentId: string): Promise<Payment[]> {
  return db
    .select({ id: payment.id, paidOn: payment.paidOn, amountMinor: payment.amountMinor, comment: payment.comment })
    .from(payment)
    .where(and(eq(payment.teacherId, teacherId), eq(payment.studentId, studentId)))
    .orderBy(desc(payment.paidOn), desc(payment.createdAt));
}

/** Records a payment received from a student of this teacher. */
export async function addPayment(
  db: Database,
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
