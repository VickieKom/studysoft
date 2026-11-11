// Loads the synthetic data from deploy/seed/ (AGENTS.md, rule 7). Running it
// again changes nothing: existing teachers and students are left as they are.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "./client";
import { account, student, teacher } from "./schema";

const seedDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../deploy/seed");

const teachersFile = z.array(z.object({ name: z.string(), email: z.email(), password: z.string().min(8) }));
const studentsFile = z.array(z.object({ teacher: z.email(), displayName: z.string() }));

async function readSeed<T>(file: string, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(JSON.parse(await readFile(path.join(seedDir, file), "utf8")));
}

export async function seed(db: Database): Promise<void> {
  const teachers = await readSeed("teachers.json", teachersFile);
  const students = await readSeed("students.json", studentsFile);

  await db.transaction(async (tx) => {
    const idByEmail = new Map<string, string>();

    for (const entry of teachers) {
      const [existing] = await tx.select({ id: teacher.id }).from(teacher).where(eq(teacher.email, entry.email));
      if (existing) {
        idByEmail.set(entry.email, existing.id);
        continue;
      }
      const [created] = await tx
        .insert(teacher)
        .values({ name: entry.name, email: entry.email, emailVerified: true })
        .returning({ id: teacher.id });
      if (!created) {
        throw new Error("seed: inserting a teacher returned no row");
      }
      // The authentication library keeps the password on a "credential" account.
      await tx.insert(account).values({
        teacherId: created.id,
        accountId: created.id,
        providerId: "credential",
        password: await hashPassword(entry.password),
      });
      idByEmail.set(entry.email, created.id);
    }

    for (const entry of students) {
      const teacherId = idByEmail.get(entry.teacher);
      if (!teacherId) {
        throw new Error(`students.json refers to a teacher missing from teachers.json`);
      }
      const [existing] = await tx
        .select({ id: student.id })
        .from(student)
        .where(and(eq(student.teacherId, teacherId), eq(student.displayName, entry.displayName)));
      if (!existing) {
        await tx.insert(student).values({ teacherId, displayName: entry.displayName });
      }
    }
  });
}
