import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Level, Profile, Status, TimeZoneId } from "../../domain/student";
import type { Database } from "../db/client";
import { student } from "../db/schema";

export type StudentFields = {
  firstName: string;
  lastName: string | null;
  level: Level;
  timeZone: TimeZoneId;
};

/** The teacher's view of a student. Teacher procedures only (#18, #41). */
export type StudentCard = StudentFields & Profile & { id: string; status: Status };

const cardColumns = {
  id: student.id,
  firstName: student.firstName,
  lastName: student.lastName,
  level: student.level,
  timeZone: student.timeZone,
  status: student.status,
  age: student.age,
  schoolYear: student.schoolYear,
  interests: student.interests,
  whatWorks: student.whatWorks,
  gaps: student.gaps,
  textbook: student.textbook,
  currentUnit: student.currentUnit,
};

// Level, time zone and status are plain text columns; the router validates
// what goes in, so what comes out is one of the known values.
function toCard(row: { [K in keyof typeof cardColumns]: string | null }): StudentCard {
  return row as StudentCard;
}

/** Students of one teacher with the given statuses, oldest first. */
export async function listStudents(db: Database, teacherId: string, statuses: readonly Status[]): Promise<StudentCard[]> {
  const rows = await db
    .select(cardColumns)
    .from(student)
    .where(and(eq(student.teacherId, teacherId), isNull(student.deletedAt), inArray(student.status, [...statuses])))
    .orderBy(asc(student.createdAt));
  return rows.map(toCard);
}

/** One student of this teacher, or null — another teacher's student is the same as a missing one. */
export async function findStudent(db: Database, teacherId: string, id: string): Promise<StudentCard | null> {
  const [row] = await db
    .select(cardColumns)
    .from(student)
    .where(and(eq(student.id, id), eq(student.teacherId, teacherId), isNull(student.deletedAt)));
  return row ? toCard(row) : null;
}

/** Creates a student with the status "Обсуждение" and returns its identifier. */
export async function createStudent(db: Database, teacherId: string, fields: StudentFields): Promise<string> {
  const [row] = await db
    .insert(student)
    .values({ teacherId, ...fields, status: "discussion" })
    .returning({ id: student.id });
  if (!row) throw new Error("createStudent: insert returned no row");
  return row.id;
}

/** Updates a student of this teacher; false when there is no such student. */
export async function updateStudent(
  db: Database,
  teacherId: string,
  id: string,
  fields: StudentFields & { status: Status } & Partial<Profile>,
): Promise<boolean> {
  const rows = await db
    .update(student)
    .set(fields)
    .where(and(eq(student.id, id), eq(student.teacherId, teacherId), isNull(student.deletedAt)))
    .returning({ id: student.id });
  return rows.length > 0;
}
