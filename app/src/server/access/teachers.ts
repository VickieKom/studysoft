import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
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
