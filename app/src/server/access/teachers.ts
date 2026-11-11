import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { teacher } from "../db/schema";

export type TeacherProfile = { id: string; name: string };

export async function findTeacher(db: Database, teacherId: string): Promise<TeacherProfile | null> {
  const [row] = await db.select({ id: teacher.id, name: teacher.name }).from(teacher).where(eq(teacher.id, teacherId));
  return row ?? null;
}
