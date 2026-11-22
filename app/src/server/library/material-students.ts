// A game made for students (#292): the students a game is marked for. The
// game stays in the library for everyone; the mark finds it by student and
// tells the assistant what was made for a child. A deleted student's mark is
// not read; an archived student keeps it. Only the teacher's own students.
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "../db/client";
import { libraryMaterial, libraryMaterialStudent, student } from "../db/schema";

/** The most students one game is marked for. */
export const MAX_MATERIAL_STUDENTS = 30;

const nameOf = (firstName: string, lastName: string | null) => (lastName ? `${firstName} ${lastName}` : firstName);

/** Whether every one of `ids` is a student of this teacher, not deleted. */
export async function ownStudents(db: Pick<Database, "select">, teacherId: string, ids: string[]): Promise<boolean> {
  if (ids.length === 0) return true;
  const rows = await db
    .select({ id: student.id })
    .from(student)
    .where(and(eq(student.teacherId, teacherId), isNull(student.deletedAt), inArray(student.id, ids)));
  return rows.length === new Set(ids).size;
}

/** Marks the game for exactly these students; the caller checks they are hers. */
export async function setMaterialStudents(db: Pick<Database, "delete" | "insert">, teacherId: string, materialId: string, ids: string[]): Promise<void> {
  await db.delete(libraryMaterialStudent).where(and(eq(libraryMaterialStudent.materialId, materialId), eq(libraryMaterialStudent.teacherId, teacherId)));
  const unique = [...new Set(ids)];
  if (unique.length > 0) await db.insert(libraryMaterialStudent).values(unique.map((studentId) => ({ materialId, studentId, teacherId })));
}

/** The students each of the materials is for, by name; deleted students left out. */
export async function materialStudents(db: Pick<Database, "select">, teacherId: string, materialIds: string[]): Promise<Map<string, { id: string; name: string }[]>> {
  const marked = new Map<string, { id: string; name: string }[]>();
  if (materialIds.length === 0) return marked;
  const rows = await db
    .select({ materialId: libraryMaterialStudent.materialId, id: student.id, firstName: student.firstName, lastName: student.lastName })
    .from(libraryMaterialStudent)
    .innerJoin(student, and(eq(student.id, libraryMaterialStudent.studentId), isNull(student.deletedAt)))
    .where(and(eq(libraryMaterialStudent.teacherId, teacherId), inArray(libraryMaterialStudent.materialId, materialIds)))
    .orderBy(asc(student.firstName), asc(student.lastName));
  for (const r of rows) marked.set(r.materialId, [...(marked.get(r.materialId) ?? []), { id: r.id, name: nameOf(r.firstName, r.lastName) }]);
  return marked;
}

/** The games made for a student, drafts included, by title: for the student context. */
export async function gamesForStudent(db: Pick<Database, "select">, teacherId: string, studentId: string): Promise<{ id: string; title: string }[]> {
  return db
    .select({ id: libraryMaterial.id, title: libraryMaterial.title })
    .from(libraryMaterialStudent)
    .innerJoin(libraryMaterial, eq(libraryMaterial.id, libraryMaterialStudent.materialId))
    .where(and(eq(libraryMaterialStudent.teacherId, teacherId), eq(libraryMaterialStudent.studentId, studentId), eq(libraryMaterial.kind, "game")))
    .orderBy(asc(libraryMaterial.title));
}
