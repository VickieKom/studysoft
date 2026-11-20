// The student context: everything a generation reads about a student, built
// in one place (architecture 8.8). The MCP tool get_student_context is a thin
// wrapper over it, and later generations (homework drafts, #43) reuse it and
// store its snapshot with the draft.
//
// Never in the context: the last name, contacts, payments, links (#18), and
// the keys of homework tasks.
import type { Database } from "../db/client";
import type { GameAnswer } from "../../domain/game-result-format";
import { type RecentHomework, recentResults } from "../homework/review";
import { countedGameResults } from "../library/game-results";
import { studentMistakes } from "./mistakes";
import { listNotes } from "./notes";
import { findStudent } from "./students";
import { CONTEXT_WORDS, studentVocabulary } from "./vocabulary";

/** How many of the latest notes the context carries (#3). */
export const CONTEXT_NOTES = 5;
/** How many of the latest game results the context carries (#119), as many as homework (#44). */
export const CONTEXT_GAMES = 3;

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
  /** The latest submitted homework, newest first (#44). */
  recentHomework: RecentHomework[];
  /** The latest results of games the student played by their link or with the teacher in a lesson, newest first (#119, #147). */
  recentGames: { title: string; playedAt: Date; playedWithTeacher: boolean; answers: GameAnswer[] }[];
  /** Mistakes of homework and games over the last 30 days, by topic, the most frequent first (#44, #119). */
  mistakesByTopic: { topic: string; count: number }[];
  /** The student's vocabulary, the newest words first (#154). */
  vocabulary: { word: string; translation: string | null }[];
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
  const mistakes = await studentMistakes(db, teacherId, studentId);
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
    recentHomework: await recentResults(db, teacherId, studentId),
    // The latest results whenever they were played; only the summary keeps to the last 30 days.
    recentGames: await countedGameResults(db, teacherId, studentId, { limit: CONTEXT_GAMES }),
    mistakesByTopic: mistakes.map(({ topic, count }) => ({ topic, count })),
    vocabulary: (await studentVocabulary(db, teacherId, studentId, CONTEXT_WORDS)).map(({ word, translation }) => ({ word, translation })),
  };
}
