import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { seedTeachers } from "../testing/requests";
import { closeDb, db } from "./client";
import { group, groupMember, student, teacher } from "./schema";

afterAll(closeDb);

async function teacherId(email: string): Promise<string> {
  const [row] = await db().select({ id: teacher.id }).from(teacher).where(eq(teacher.email, email));
  if (!row) throw new Error("seed teacher missing");
  return row.id;
}

describe("group membership stays inside one teacher", () => {
  it("is refused by the database when the group and the student belong to different teachers", async () => {
    const [emailA, emailB] = seedTeachers.map((t) => t.email);
    const a = await teacherId(emailA!);
    const b = await teacherId(emailB!);
    const [groupOfA] = await db().insert(group).values({ teacherId: a, name: "group" }).returning();
    const [studentOfB] = await db().select().from(student).where(eq(student.teacherId, b));
    const [studentOfA] = await db().insert(student).values({ teacherId: a, firstName: "x" }).returning();

    // Whichever teacher the row claims, one of the two composite keys fails.
    for (const claimed of [a, b]) {
      await expect(
        db().insert(groupMember).values({ groupId: groupOfA!.id, studentId: studentOfB!.id, teacherId: claimed }),
      ).rejects.toThrow();
    }

    // The same teacher's group and student are accepted.
    await expect(
      db().insert(groupMember).values({ groupId: groupOfA!.id, studentId: studentOfA!.id, teacherId: a }),
    ).resolves.toBeDefined();
  });
});
