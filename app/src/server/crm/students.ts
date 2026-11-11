import { and, asc, eq, isNull } from "drizzle-orm";
import type { Database } from "../db/client";
import { student } from "../db/schema";

export type StudentSummary = { id: string; displayName: string };

/** Active students of one teacher, oldest first. */
export async function listStudents(db: Database, teacherId: string): Promise<StudentSummary[]> {
  return db
    .select({ id: student.id, displayName: student.displayName })
    .from(student)
    .where(and(eq(student.teacherId, teacherId), isNull(student.deletedAt)))
    .orderBy(asc(student.createdAt));
}
