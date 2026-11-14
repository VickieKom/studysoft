// Creates one teacher account from the environment: TEACHER_NAME,
// TEACHER_EMAIL, TEACHER_PASSWORD. For environments with real data, where the
// seed script never runs. The values come from the environment and not from
// arguments, so the password stays out of the process list.
import { z } from "zod";
import { createTeacher } from "../../access/teachers";
import { closeDb, db } from "../client";

const input = z
  .object({
    TEACHER_NAME: z.string().trim().min(1),
    // The authentication library looks an account up by the lower-cased email.
    TEACHER_EMAIL: z.email().toLowerCase(),
    TEACHER_PASSWORD: z.string().min(12, "TEACHER_PASSWORD must be at least 12 characters"),
  })
  .safeParse(process.env);

if (!input.success) {
  const fields = input.error.issues.map((issue) => issue.path.join(".")).join(", ");
  console.error(`create-teacher: invalid environment: ${fields}`);
  process.exit(1);
}

const created = await createTeacher(db(), {
  name: input.data.TEACHER_NAME,
  email: input.data.TEACHER_EMAIL,
  password: input.data.TEACHER_PASSWORD,
});
await closeDb();
// Logs carry internal identifiers only.
console.log(created ? `teacher created: ${created.id}` : "teacher exists, nothing changed");
