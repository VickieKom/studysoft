// The family's goal and a personal measure on the student card (#266): the
// goal as text, the measure as a name and a unit of the teacher's own, and
// the numbers she enters when marking a lesson «Проведён». The card shows the
// measure over the last 30 days as first → last. Teacher only: no student,
// parent or agent procedure reads any of it yet.
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

/** Saves the goal and the measure; false when the student is not this teacher's. */
export async function saveGoal(db: Database, teacherId: string, studentId: string, goal: Goal): Promise<boolean> {
  const rows = await db
    .update(student)
    .set({ ...goal, updatedAt: new Date() })
    .where(and(eq(student.id, studentId), eq(student.teacherId, teacherId), isNull(student.deletedAt)))
    .returning({ id: student.id });
  return rows.length > 0;
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
