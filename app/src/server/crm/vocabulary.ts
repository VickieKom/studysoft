// The student's vocabulary (#154): the words added when a lesson is finished
// (lesson/finish.ts) and by hand on the card (#236). The teacher sees and
// corrects them on the card, the assistant reads them in the student context,
// and the student sees them in «Тренировка слов» behind their link (#236).
// The assistant proposes translations and examples as a draft beside the
// confirmed ones; the student sees only what the teacher confirmed (#237).
// One word per student whatever its case, kept by a unique index.
import { and, asc, desc, eq, isNotNull, or, sql } from "drizzle-orm";
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
      draftTranslation: vocabularyWord.draftTranslation,
      draftExample: vocabularyWord.draftExample,
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
  // Confirmed only: the assistant's drafts stay on the card until the teacher confirms them (#237).
  return (await studentVocabulary(db, teacherId, studentId)).map(({ id, word, translation, example }) => ({ id, word, translation, example }));
}

/** A word's draft as the card and the assistant see it, or null when there is none. */
export function draftOf(w: { draftTranslation: string | null; draftExample: string | null }) {
  return w.draftTranslation === null && w.draftExample === null ? null : { translation: w.draftTranslation, example: w.draftExample };
}

/** The student's words for the assistant: what is confirmed and its own draft, with the ids it saves drafts by. */
export async function wordsForAgent(db: Database, teacherId: string, studentId: string) {
  return (await studentVocabulary(db, teacherId, studentId)).map((w) => ({
    id: w.id,
    word: w.word,
    translation: w.translation,
    example: w.example,
    draft: draftOf(w),
  }));
}

/** Rolls back a transaction that found a word it could not change; nothing of it is kept. */
class Refused extends Error {}

export type WordDraft = { wordId: string; translation: string; example: string };

/**
 * The assistant's translations and examples, saved as each word's draft
 * (#237): what is confirmed stays as it is. Empty text is none; a word given
 * neither has its draft cleared. All the words must be this student's, or
 * nothing is saved.
 */
export async function saveWordDrafts(db: Database, teacherId: string, studentId: string, drafts: WordDraft[]): Promise<"saved" | "not_found"> {
  return db.transaction(async (tx) => {
    for (const draft of drafts) {
      const rows = await tx
        .update(vocabularyWord)
        .set({ draftTranslation: optional(draft.translation), draftExample: optional(draft.example), updatedAt: sql`now()` })
        .where(and(eq(vocabularyWord.id, draft.wordId), eq(vocabularyWord.teacherId, teacherId), eq(vocabularyWord.studentId, studentId)))
        .returning({ id: vocabularyWord.id });
      if (rows.length === 0) throw new Refused();
    }
    return "saved" as const;
  }).catch((error: unknown) => {
    if (error instanceof Refused) return "not_found" as const;
    throw error;
  });
}

export type SeenDraft = { id: string; translation: string | null; example: string | null };

/**
 * «Подтвердить» or «Подтвердить все» (#237): each word's draft, as the
 * teacher's page showed it, becomes its translation and example — a draft
 * part that is empty keeps what was confirmed. Conditional on the draft being
 * the one she saw: one the assistant replaced meanwhile is "conflict", and
 * nothing is confirmed.
 */
export async function confirmWordDrafts(db: Database, teacherId: string, studentId: string, seen: SeenDraft[]): Promise<"saved" | "conflict"> {
  return db.transaction(async (tx) => {
    for (const draft of seen) {
      const rows = await tx
        .update(vocabularyWord)
        .set({
          translation: sql`coalesce(${vocabularyWord.draftTranslation}, ${vocabularyWord.translation})`,
          example: sql`coalesce(${vocabularyWord.draftExample}, ${vocabularyWord.example})`,
          draftTranslation: null,
          draftExample: null,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(vocabularyWord.id, draft.id),
            eq(vocabularyWord.teacherId, teacherId),
            eq(vocabularyWord.studentId, studentId),
            or(isNotNull(vocabularyWord.draftTranslation), isNotNull(vocabularyWord.draftExample)),
            sql`${vocabularyWord.draftTranslation} is not distinct from ${draft.translation}`,
            sql`${vocabularyWord.draftExample} is not distinct from ${draft.example}`,
          ),
        )
        .returning({ id: vocabularyWord.id });
      if (rows.length === 0) throw new Refused();
    }
    return "saved" as const;
  }).catch((error: unknown) => {
    if (error instanceof Refused) return "conflict" as const;
    throw error;
  });
}
