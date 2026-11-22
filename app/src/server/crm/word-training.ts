// The daily word training behind the student's link (#238). Today's words
// are the student's words with a translation that are due in their time
// zone, at most a session's worth; «Ещё разок» takes random ones. Each word
// gets one exercise (domain/word-training.ts). The answer is checked here,
// never on the page, and moves the word with a write conditional on the
// state it was checked against, so two tabs answering the same word never
// move it twice.
import { and, asc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { todayIn } from "../../domain/homework";
import {
  addDays,
  afterAnswer,
  CHOICE_OPTIONS,
  type ExerciseType,
  exerciseFor,
  gapSentence,
  isDue,
  SESSION_WORDS,
} from "../../domain/word-training";
import type { Database } from "../db/client";
import { student, vocabularyWord } from "../db/schema";
import { normalize } from "../homework/check";

export type Exercise = { wordId: string; type: ExerciseType; prompt: string; options: string[] | null };

async function studentToday(db: Pick<Database, "select">, teacherId: string, studentId: string, now: Date): Promise<string | null> {
  const [row] = await db
    .select({ timeZone: student.timeZone })
    .from(student)
    .where(and(eq(student.id, studentId), eq(student.teacherId, teacherId), isNull(student.deletedAt)));
  return row ? todayIn(row.timeZone, now) : null;
}

const own = (teacherId: string, studentId: string) =>
  and(eq(vocabularyWord.teacherId, teacherId), eq(vocabularyWord.studentId, studentId), isNotNull(vocabularyWord.translation));

const dueBy = (today: string) => or(isNull(vocabularyWord.dueOn), lte(vocabularyWord.dueOn, today));

/** How many words are due today, for «Слов на сегодня». */
export async function dueToday(db: Database, teacherId: string, studentId: string, now: Date = new Date()): Promise<number> {
  const today = await studentToday(db, teacherId, studentId, now);
  if (!today) return 0;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(vocabularyWord)
    .where(and(own(teacherId, studentId), dueBy(today)));
  return Math.min(row?.count ?? 0, SESSION_WORDS);
}

function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/** A training: today's due words, or with `extra` random words; one exercise each, without the answers' keys. */
export async function trainingSession(db: Database, teacherId: string, studentId: string, extra: boolean, now: Date = new Date()): Promise<Exercise[]> {
  const today = await studentToday(db, teacherId, studentId, now);
  if (!today) return [];
  const all = await db
    .select({
      id: vocabularyWord.id,
      word: vocabularyWord.word,
      translation: vocabularyWord.translation,
      example: vocabularyWord.example,
      step: vocabularyWord.trainStep,
      dueOn: vocabularyWord.dueOn,
    })
    .from(vocabularyWord)
    .where(own(teacherId, studentId))
    .orderBy(asc(vocabularyWord.dueOn), asc(vocabularyWord.createdAt));
  // New words (no date) first, then the longest due.
  const due = [...all.filter((w) => w.dueOn === null), ...all.filter((w) => w.dueOn !== null && isDue(w.dueOn, today))];
  const words = extra ? shuffled(all).slice(0, SESSION_WORDS) : due.slice(0, SESSION_WORDS);
  return words.map((w) => {
    const others = all.filter((o) => o.id !== w.id);
    const canChoose = others.length >= CHOICE_OPTIONS - 1;
    // Only the confirmed example: the assistant's draft is not the student's until the teacher confirms it (#237).
    const gapped = gapSentence(w.example, w.word);
    const type = exerciseFor(w.step, canChoose, gapped !== null, extra);
    const pick = (field: "word" | "translation") =>
      shuffled([w[field]!, ...shuffled([...new Set(others.map((o) => o[field]!).filter((v) => normalize(v) !== normalize(w[field]!)))]).slice(0, CHOICE_OPTIONS - 1)]);
    if (type === "choose_translation") return { wordId: w.id, type, prompt: w.word, options: pick("translation") };
    if (type === "choose_word") return { wordId: w.id, type, prompt: w.translation!, options: pick("word") };
    if (type === "fill_gap") return { wordId: w.id, type, prompt: gapped!, options: canChoose ? pick("word") : null };
    return { wordId: w.id, type, prompt: w.translation!, options: null };
  });
}

export type Checked = { right: boolean; correct: string };
type Answer = { wordId: string; type: ExerciseType; answer: string; extra: boolean };
export type SeenWord = { word: string; translation: string | null; example: string | null; step: number; dueOn: string | null };

/** The word as an answer is checked against, or null when it is not this student's or has no translation. */
export async function readWord(db: Database, teacherId: string, studentId: string, wordId: string): Promise<SeenWord | null> {
  const [w] = await db
    .select({
      word: vocabularyWord.word,
      translation: vocabularyWord.translation,
      example: vocabularyWord.example,
      step: vocabularyWord.trainStep,
      dueOn: vocabularyWord.dueOn,
    })
    .from(vocabularyWord)
    .where(and(eq(vocabularyWord.id, wordId), own(teacherId, studentId)));
  return w ?? null;
}

/**
 * Checks the answer against the word as `seen` and moves it, conditional on
 * the word still being as seen: "changed" when another answer came between.
 */
export async function applyAnswer(
  db: Database,
  teacherId: string,
  studentId: string,
  input: Answer,
  seen: SeenWord,
  today: string,
  now: Date,
): Promise<Checked | "changed"> {
  const expected = input.type === "choose_translation" ? seen.translation! : seen.word;
  const right = normalize(input.answer) === normalize(expected);
  // A gap is answered with the word; the child is shown the sentence whole (#239).
  const correct = input.type === "fill_gap" && gapSentence(seen.example, seen.word) !== null ? seen.example! : expected;
  const next = afterAnswer({ step: seen.step, dueOn: seen.dueOn }, right, today, !input.extra && isDue(seen.dueOn, today));
  const rows = await db
    .update(vocabularyWord)
    .set({
      trainStep: next.step,
      dueOn: next.dueOn,
      rightCount: sql`${vocabularyWord.rightCount} + ${right ? 1 : 0}`,
      wrongCount: sql`${vocabularyWord.wrongCount} + ${right ? 0 : 1}`,
      trainedAt: now,
    })
    .where(
      and(
        eq(vocabularyWord.id, input.wordId),
        own(teacherId, studentId),
        eq(vocabularyWord.trainStep, seen.step),
        seen.dueOn === null ? isNull(vocabularyWord.dueOn) : eq(vocabularyWord.dueOn, seen.dueOn),
      ),
    )
    .returning({ id: vocabularyWord.id });
  return rows.length > 0 ? { right, correct } : "changed";
}

/**
 * Checks one answer and moves the word (domain/word-training.ts). With
 * `extra`, or for a word not due today, a right answer moves nothing. An
 * answer that met another one in between is checked again against it. Null
 * for a word that is not this student's or has no translation.
 */
export async function answerExercise(db: Database, teacherId: string, studentId: string, input: Answer, now: Date = new Date()): Promise<Checked | null> {
  const today = await studentToday(db, teacherId, studentId, now);
  if (!today) return null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const seen = await readWord(db, teacherId, studentId, input.wordId);
    if (!seen) return null;
    const applied = await applyAnswer(db, teacherId, studentId, input, seen, today, now);
    if (applied !== "changed") return applied;
  }
  throw new Error("answerExercise: the word kept changing");
}

/**
 * Words the student got wrong outside the training: in a submitted homework
 * (#284), in the submission's transaction, or in a game template's result
 * (#285): each counts one mistake towards «часто
 * ошибается», starts again from the first interval and is due tomorrow in
 * the student's time zone — unless it is due by then already, or new.
 * A right answer in homework moves nothing: «закрепилось» comes from the
 * training only.
 */
export async function missedOutsideTraining(db: Pick<Database, "select" | "update">, teacherId: string, studentId: string, ids: string[], now: Date = new Date()): Promise<void> {
  if (ids.length === 0) return;
  const today = await studentToday(db, teacherId, studentId, now);
  if (!today) return;
  const tomorrow = addDays(today, 1);
  await db
    .update(vocabularyWord)
    .set({
      wrongCount: sql`${vocabularyWord.wrongCount} + 1`,
      trainStep: 0,
      dueOn: sql`CASE WHEN ${vocabularyWord.dueOn} IS NULL OR ${vocabularyWord.dueOn} <= ${tomorrow} THEN ${vocabularyWord.dueOn} ELSE ${tomorrow}::date END`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(vocabularyWord.teacherId, teacherId), eq(vocabularyWord.studentId, studentId), inArray(vocabularyWord.id, ids)));
}
