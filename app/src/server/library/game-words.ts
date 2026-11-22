// The words a game template gets (#282): a student's words with a confirmed
// translation, with the confirmed example when there is one, the newest
// first. Only for a game of this teacher marked «Со словами словаря» and a
// student of hers; anything else is null, the same as a missing game. The
// callers decide which student: the one the teacher picks, the lesson's, or
// the student behind the link.
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { type GameWord, MAX_GAME_WORDS } from "../../domain/game-words-format";
import type { Database } from "../db/client";
import { lesson, libraryMaterial, student, vocabularyWord } from "../db/schema";

async function isTemplate(db: Database, teacherId: string, materialId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: libraryMaterial.id })
    .from(libraryMaterial)
    .where(and(eq(libraryMaterial.id, materialId), eq(libraryMaterial.teacherId, teacherId), eq(libraryMaterial.kind, "game"), eq(libraryMaterial.vocabulary, true)));
  return row !== undefined;
}

async function studentWords(db: Database, teacherId: string, studentId: string): Promise<GameWord[]> {
  const rows = await db
    .select({ word: vocabularyWord.word, translation: vocabularyWord.translation, example: vocabularyWord.example })
    .from(vocabularyWord)
    .where(and(eq(vocabularyWord.teacherId, teacherId), eq(vocabularyWord.studentId, studentId), isNotNull(vocabularyWord.translation)))
    .orderBy(desc(vocabularyWord.createdAt), vocabularyWord.word)
    .limit(MAX_GAME_WORDS);
  return rows.map((r) => ({ word: r.word, translation: r.translation!, ...(r.example ? { example: r.example } : {}) }));
}

/** The words of this teacher's student for her game template, or null. */
export async function templateWords(db: Database, teacherId: string, materialId: string, studentId: string): Promise<GameWord[] | null> {
  if (!(await isTemplate(db, teacherId, materialId))) return null;
  const [own] = await db
    .select({ id: student.id })
    .from(student)
    .where(and(eq(student.id, studentId), eq(student.teacherId, teacherId), isNull(student.deletedAt)));
  return own ? studentWords(db, teacherId, studentId) : null;
}

/** The words of a lesson's student for a game template on the stage, or null. */
export async function lessonTemplateWords(db: Database, teacherId: string, lessonId: string, materialId: string): Promise<GameWord[] | null> {
  const [found] = await db
    .select({ studentId: lesson.studentId })
    .from(lesson)
    .where(and(eq(lesson.id, lessonId), eq(lesson.teacherId, teacherId)));
  return found ? templateWords(db, teacherId, materialId, found.studentId) : null;
}
