// The student's words for «Из словаря» in a homework draft (#281): those
// with a confirmed translation, newest first, the words of the last lesson
// they came from and the weak ones ticked, at most PICKED_WORDS. The tasks
// are built on the teacher's page (domain/vocabulary-homework.ts) and saved
// like any edit of the draft, keeping only word ids of this student.
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { PICKED_WORDS } from "../../domain/vocabulary-homework";
import { wordMark } from "../../domain/word-training";
import type { Database } from "../db/client";
import { lesson, vocabularyWord } from "../db/schema";

export type WordToPick = { id: string; word: string; translation: string; ticked: boolean };

export async function wordsToPick(db: Database, teacherId: string, studentId: string): Promise<WordToPick[]> {
  const mine = and(eq(vocabularyWord.teacherId, teacherId), eq(vocabularyWord.studentId, studentId));
  const rows = await db
    .select({
      id: vocabularyWord.id,
      word: vocabularyWord.word,
      translation: vocabularyWord.translation,
      lessonId: vocabularyWord.lessonId,
      step: vocabularyWord.trainStep,
      rightCount: vocabularyWord.rightCount,
      wrongCount: vocabularyWord.wrongCount,
      trainedAt: vocabularyWord.trainedAt,
    })
    .from(vocabularyWord)
    .where(and(mine, isNotNull(vocabularyWord.translation)))
    .orderBy(desc(vocabularyWord.createdAt), vocabularyWord.word);
  // The last lesson that brought words, by when it took place.
  const [last] = await db
    .select({ id: lesson.id })
    .from(lesson)
    .innerJoin(vocabularyWord, eq(vocabularyWord.lessonId, lesson.id))
    .where(mine)
    .orderBy(desc(lesson.startsAt))
    .limit(1);
  const weak = (r: (typeof rows)[number]) => wordMark({ step: r.step, rightCount: r.rightCount, wrongCount: r.wrongCount, trained: r.trainedAt !== null }) === "often_wrong";
  const first = [...new Set([...rows.filter((r) => last && r.lessonId === last.id), ...rows.filter(weak)].map((r) => r.id))];
  const ticked = new Set(first.slice(0, PICKED_WORDS));
  return rows.map((r) => ({ id: r.id, word: r.word, translation: r.translation!, ticked: ticked.has(r.id) }));
}

/** Which of `ids` are words of this student's vocabulary. */
export async function studentWordIds(db: Database, teacherId: string, studentId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: vocabularyWord.id })
    .from(vocabularyWord)
    .where(and(eq(vocabularyWord.teacherId, teacherId), eq(vocabularyWord.studentId, studentId), inArray(vocabularyWord.id, ids)));
  return new Set(rows.map((r) => r.id));
}
