// The student's vocabulary (#154): the words added when a lesson is finished
// (lesson/finish.ts) and by hand on the card (#236). The teacher sees and
// corrects them on the card, the assistant reads them in the student context,
// and the student sees them in «Тренировка слов» behind their link (#236).
// One word per student whatever its case, kept by a unique index.
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { vocabularyWord } from "../db/schema";

/** How many of the newest words the student context carries. */
export const CONTEXT_WORDS = 300;

/** The student's words, newest first; optionally only the newest `limit`. */
export async function studentVocabulary(db: Database, teacherId: string, studentId: string, limit?: number) {
  const query = db
    .select({
      id: vocabularyWord.id,
      word: vocabularyWord.word,
      translation: vocabularyWord.translation,
      example: vocabularyWord.example,
      addedAt: vocabularyWord.createdAt,
    })
    .from(vocabularyWord)
    .where(and(eq(vocabularyWord.teacherId, teacherId), eq(vocabularyWord.studentId, studentId)))
    .orderBy(desc(vocabularyWord.createdAt), asc(vocabularyWord.word));
  return limit ? query.limit(limit) : query;
}

export type WordInput = { word: string; translation: string; example: string };
type Changed = "saved" | "not_found" | "duplicate";

/** Empty text is no translation or example. */
const optional = (value: string) => (value.trim() === "" ? null : value.trim());

/** The unique index says the student has the word already, in some case. */
function isDuplicate(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string; constraint_name?: string } })?.cause ?? (error as { code?: string; constraint_name?: string });
  return cause?.code === "23505";
}

/** «Добавить слово» on the card: a word of the student's, by hand. The student must be this teacher's (the caller checks). */
export async function addWord(db: Database, teacherId: string, studentId: string, input: WordInput): Promise<Changed> {
  try {
    await db.insert(vocabularyWord).values({
      teacherId,
      studentId,
      word: input.word.trim(),
      translation: optional(input.translation),
      example: optional(input.example),
    });
    return "saved";
  } catch (error) {
    if (isDuplicate(error)) return "duplicate";
    throw error;
  }
}

/** «Изменить»: the word, its translation and its example, as the teacher typed them. */
export async function updateWord(db: Database, teacherId: string, studentId: string, id: string, input: WordInput): Promise<Changed> {
  try {
    const rows = await db
      .update(vocabularyWord)
      .set({ word: input.word.trim(), translation: optional(input.translation), example: optional(input.example), updatedAt: sql`now()` })
      .where(and(eq(vocabularyWord.id, id), eq(vocabularyWord.teacherId, teacherId), eq(vocabularyWord.studentId, studentId)))
      .returning({ id: vocabularyWord.id });
    return rows.length > 0 ? "saved" : "not_found";
  } catch (error) {
    if (isDuplicate(error)) return "duplicate";
    throw error;
  }
}

/** «Удалить»: the word leaves the student's vocabulary. */
export async function deleteWord(db: Database, teacherId: string, studentId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(vocabularyWord)
    .where(and(eq(vocabularyWord.id, id), eq(vocabularyWord.teacherId, teacherId), eq(vocabularyWord.studentId, studentId)))
    .returning({ id: vocabularyWord.id });
  return rows.length > 0;
}

/** What the student sees of their words: no ids of anything else, no lesson, nothing of the teacher's. */
export async function wordsForStudent(db: Database, teacherId: string, studentId: string) {
  return (await studentVocabulary(db, teacherId, studentId)).map(({ id, word, translation, example }) => ({ id, word, translation, example }));
}
