import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "../db/client";
import { accessLink } from "../db/schema";
import { createServerCaller } from "../router";
import { seedTeachers, signedInHeaders } from "../testing/requests";
import { bumpGeneration, ensureLink, revokeLinks } from "./links";

const [teacherA] = seedTeachers as [(typeof seedTeachers)[number]];

let teacherId: string;
let studentId: string;

beforeAll(async () => {
  const teacher = createServerCaller(await signedInHeaders(teacherA));
  teacherId = (await teacher.teacher.session.me()).id;
  ({ id: studentId } = await teacher.teacher.students.create({
    firstName: "Гонка",
    lastName: "",
    level: "A2",
    timeZone: "Europe/Moscow",
  }));
});

afterAll(closeDb);

describe("a reissue racing «Завершили»", () => {
  it("does not lift a revocation that landed after the link was read", async () => {
    // The reissue has read the open link...
    const read = await ensureLink(db(), teacherId, studentId, "student");
    expect(read.revokedAt).toBeNull();
    // ...«Завершили» revokes it, leaving the generation as it was...
    await revokeLinks(db(), teacherId, studentId);
    // ...and the reissue's update must not reopen it.
    await expect(bumpGeneration(db(), read, "student")).rejects.toThrow();
    const [row] = await db().select().from(accessLink).where(eq(accessLink.id, read.id));
    expect(row!.revokedAt).not.toBeNull();
    expect(row!.generation).toBe(read.generation);
  });
});
