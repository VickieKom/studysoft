// Creates one teacher account from the environment: TEACHER_NAME,
// TEACHER_EMAIL, TEACHER_PASSWORD (12 characters or more). For environments
// with real data, where the seed script never runs. The values come from the
// environment and not from arguments, so the password stays out of the
// process list.
import { createTeacher, parseTeacherInput } from "../../access/teachers";
import { closeDb, db } from "../client";

const input = parseTeacherInput(process.env);
if (!input.ok) {
  console.error(`create-teacher: invalid environment: ${input.fields.join(", ")}`);
  process.exit(1);
}

const created = await createTeacher(db(), input);
await closeDb();
// Logs carry internal identifiers only.
console.log(created ? `teacher created: ${created.id}` : "teacher exists, nothing changed");
