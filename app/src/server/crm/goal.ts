// The family's goal and a personal measure on the student card (#266): the
// goal as text, the measure as a name and a unit of the teacher's own, and
// the numbers she enters when marking a lesson «Проведён». The card shows the
// measure over the last 30 days as first → last. Teacher only: no student,
// parent or agent procedure reads any of it yet.
import { sameMeasure } from "../../domain/student";
import { and, asc, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";
import type { Database } from "../db/client";
import { lesson, student } from "../db/schema";

/** How far back the card counts the measure. */
export const MEASURE_DAYS = 30;

export type Goal = { familyGoal: string | null; measureName: string | null; measureUnit: string | null };

/** The student's goal and measure, or null when the student is not this teacher's. */
export async function findGoal(db: Database, teacherId: string, studentId: string): Promise<Goal | null> {
  const [row] = await db
    .select({ familyGoal: student.familyGoal, measureName: student.measureName, measureUnit: student.measureUnit })
    .from(student)
    .where(and(eq(student.id, studentId), eq(student.teacherId, teacherId), isNull(student.deletedAt)));
  return row ?? null;
}

/**
 * Saves the goal and the measure; false when the student is not this
 * teacher's. Another name or unit is another measure (#279, product owner,
 * 2026-11-22): the numbers of the measure before are erased from the
 * student's lessons in the same transaction, the student's row locked for
 * the comparison, so the card and a report draft count from zero and a
 * correction of an old lesson cannot bring its number back. A published
 * report keeps the numbers it froze.
 */
export async function saveGoal(db: Database, teacherId: string, studentId: string, goal: Goal): Promise<boolean> {
  return db.transaction(async (tx) => {
    const own = and(eq(student.id, studentId), eq(student.teacherId, teacherId), isNull(student.deletedAt));
    const [before] = await tx.select({ measureName: student.measureName, measureUnit: student.measureUnit }).from(student).where(own).for("update");
    if (!before) return false;
    await tx.update(student).set({ ...goal, updatedAt: new Date() }).where(own);
    if (!sameMeasure(before, goal)) {
      await tx.update(lesson).set({ measure: null }).where(and(eq(lesson.teacherId, teacherId), eq(lesson.studentId, studentId), isNotNull(lesson.measure)));
    }
    return true;
  });
}

/** The numbers of the held lessons from `from` to `to`, oldest first. */
export async function measureValues(db: Database, teacherId: string, studentId: string, from: Date, to: Date): Promise<number[]> {
  const rows = await db
    .select({ value: lesson.measure })
    .from(lesson)
    .where(
      and(
        eq(lesson.teacherId, teacherId),
        eq(lesson.studentId, studentId),
        eq(lesson.status, "held"),
        isNotNull(lesson.measure),
        gte(lesson.startsAt, from),
        lte(lesson.startsAt, to),
      ),
    )
    .orderBy(asc(lesson.startsAt));
  return rows.map((r) => r.value!);
}
