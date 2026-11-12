// The teacher's own settings (architecture 5.4: the `teacher` row holds the
// account and its settings). For now the time zone of the schedule (#80).
import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { teacher } from "../db/schema";

/** The teacher's time zone: her time of every lesson is shown in it. */
export async function teacherTimeZone(db: Database, teacherId: string): Promise<string> {
  const [row] = await db.select({ timeZone: teacher.timeZone }).from(teacher).where(eq(teacher.id, teacherId));
  if (!row) throw new Error("teacherTimeZone: no such teacher");
  return row.timeZone;
}

/** Sets the teacher's time zone; lessons keep their moments, so only her times change. */
export async function setTeacherTimeZone(db: Database, teacherId: string, timeZone: string): Promise<void> {
  await db.update(teacher).set({ timeZone }).where(eq(teacher.id, teacherId));
}
