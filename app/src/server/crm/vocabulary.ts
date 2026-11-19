// The student's vocabulary (#154): the words added when a lesson is finished
// (lesson/finish.ts). The teacher sees it on the card and the assistant in the
// student context; the student does not see it yet (stage 2).
import { and, asc, desc, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { vocabularyWord } from "../db/schema";

/** How many of the newest words the student context carries. */
export const CONTEXT_WORDS = 300;

/** The student's words, newest first; optionally only the newest `limit`. */
export async function studentVocabulary(db: Database, teacherId: string, studentId: string, limit?: number) {
  const query = db
    .select({ word: vocabularyWord.word, translation: vocabularyWord.translation, addedAt: vocabularyWord.createdAt })
    .from(vocabularyWord)
    .where(and(eq(vocabularyWord.teacherId, teacherId), eq(vocabularyWord.studentId, studentId)))
    .orderBy(desc(vocabularyWord.createdAt), asc(vocabularyWord.word));
  return limit ? query.limit(limit) : query;
}
