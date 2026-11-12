// The student context: everything a generation reads about a student, built
// in one place (architecture 8.8). The MCP tool get_student_context is a thin
// wrapper over it, and later generations (homework drafts, #43) reuse it and
// store its snapshot with the draft.
//
// Never in the context: the last name, contacts, payments, links (#18).
import type { Database } from "../db/client";
import { listNotes } from "./notes";
import { findStudent } from "./students";

/** How many of the latest notes the context carries (#3). */
export const CONTEXT_NOTES = 5;

export type StudentContext = {
  firstName: string;
  age: string | null;
  schoolYear: string | null;
  level: string;
  textbook: string | null;
  currentUnit: string | null;
  interests: string | null;
  whatWorks: string | null;
  gaps: string | null;
  notes: { body: string; createdAt: Date }[];
};

/** The context of one student of this teacher, or null — another teacher's student is the same as a missing one. */
export async function buildStudentContext(
  db: Database,
  teacherId: string,
  studentId: string,
): Promise<StudentContext | null> {
  const card = await findStudent(db, teacherId, studentId);
  if (!card) return null;
  const notes = (await listNotes(db, teacherId, studentId))
    .slice(0, CONTEXT_NOTES)
    .map((note) => ({ body: note.body, createdAt: note.createdAt }));
  return {
    firstName: card.firstName,
    age: card.age,
    schoolYear: card.schoolYear,
    level: card.level,
    textbook: card.textbook,
    currentUnit: card.currentUnit,
    interests: card.interests,
    whatWorks: card.whatWorks,
    gaps: card.gaps,
    notes,
  };
}
