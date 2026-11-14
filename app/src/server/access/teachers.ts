import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { account, teacher } from "../db/schema";

export type TeacherProfile = { id: string; name: string };

export async function findTeacher(db: Database, teacherId: string): Promise<TeacherProfile | null> {
  const [row] = await db.select({ id: teacher.id, name: teacher.name }).from(teacher).where(eq(teacher.id, teacherId));
  return row ?? null;
}

/**
 * Creates a teacher who signs in with a password. Sign-up is closed, so this
 * is how the first account of an environment with real data appears; the seed
 * script covers the synthetic ones. Returns null when the email is taken:
 * running it again changes nothing, the existing password included.
 */
export async function createTeacher(
  db: Database,
  input: { name: string; email: string; password: string },
): Promise<{ id: string } | null> {
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(teacher)
      .values({ name: input.name, email: input.email, emailVerified: true })
      .onConflictDoNothing({ target: teacher.email })
      .returning({ id: teacher.id });
    if (!created) return null;
    // The authentication library keeps the password on a "credential" account.
    await tx.insert(account).values({
      teacherId: created.id,
      accountId: created.id,
      providerId: "credential",
      password: await hashPassword(input.password),
    });
    return created;
  });
}

const teacherInput = z.object({
  TEACHER_NAME: z.string().trim().min(1),
  // The authentication library looks an account up by the lower-cased email.
  TEACHER_EMAIL: z.email().toLowerCase(),
  TEACHER_PASSWORD: z.string().min(12),
});

/**
 * Reads the account for createTeacher from environment variables. On invalid
 * input returns only the names of the offending variables, never their values.
 */
export function parseTeacherInput(
  source: Record<string, string | undefined>,
): { ok: true; name: string; email: string; password: string } | { ok: false; fields: string[] } {
  const result = teacherInput.safeParse(source);
  if (!result.success) {
    return { ok: false, fields: [...new Set(result.error.issues.map((issue) => issue.path.join(".")))] };
  }
  const { TEACHER_NAME: name, TEACHER_EMAIL: email, TEACHER_PASSWORD: password } = result.data;
  return { ok: true, name, email, password };
}
