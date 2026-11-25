// «Что заходит» (#333), from the child's answers: the one-tap question after
// a homework (#331) and the answered surveys about the lessons (#332),
// gathered into the ratings of `domain/feedback-rating.ts`. «Новый фидбэк» on
// the teacher's general screen: a student with an answer newer than the
// newest one «Фидбэк» showed her (product owner, 2026-11-24: seen once she
// scrolls to it; answers before the release count as seen). The teacher's
// only — no student or parent procedure reads it.
import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import {
  type FunAnswer,
  RATED_MATERIAL_KINDS,
  type Rated,
  type RatedMaterialKind,
  rateMaterialKinds,
  rateMehKinds,
  rateTaskKinds,
  rateTopics,
} from "../../domain/feedback-rating";
import type { ALL_KINDS_ANSWER } from "../../domain/homework";
import type { HomeworkDocument, TaskType } from "../../domain/homework-format";
import { BOTH_FUN, BOTH_MEH, CLARITY_FACES, type SurveyQuestion } from "../../domain/survey";

/** «пока путаюсь»: a topic the child finds hard. */
const STRUGGLING = CLARITY_FACES[2];
import type { Database } from "../db/client";
import { homework, homeworkFeedback, homeworkSurvey, libraryMaterial, student } from "../db/schema";
import { taskKinds } from "./feedback";

export type FeedbackRating = {
  tasks: Rated<TaskType>[];
  materials: Rated<RatedMaterialKind>[];
  topics: { topic: string; chosen: number }[];
};

/** The answers of these students (all of the teacher's when `studentIds` is null), as the ratings count them. */
async function ratingOf(database: Database, teacherId: string, studentIds: string[] | null): Promise<FeedbackRating> {
  return (await ratingWithPairs(database, teacherId, studentIds)).rating;
}

/** The ratings, and the survey's pairs by kind as the child answered them. */
async function ratingWithPairs(
  database: Database,
  teacherId: string,
  studentIds: string[] | null,
  // Only the answers given from this moment (#377: «За месяц»); null for all time.
  since: Date | null = null,
): Promise<{ rating: FeedbackRating; funAnswers: FunAnswer[] }> {
  const whose = <T extends typeof homeworkFeedback | typeof homeworkSurvey>(table: T) =>
    studentIds ? inArray(table.studentId, studentIds) : undefined;
  const mini = await database
    .select({ answer: homeworkFeedback.answer, document: homework.document })
    .from(homeworkFeedback)
    .innerJoin(homework, eq(homework.id, homeworkFeedback.homeworkId))
    // A deleted student's answers count no more, here or across students.
    .innerJoin(student, and(eq(student.id, homeworkFeedback.studentId), isNull(student.deletedAt)))
    .where(
      and(eq(homeworkFeedback.teacherId, teacherId), whose(homeworkFeedback), isNotNull(homeworkFeedback.answer), since ? gte(homeworkFeedback.createdAt, since) : undefined),
    );
  const surveys = await database
    .select({ questions: homeworkSurvey.questions, answers: homeworkSurvey.answers })
    .from(homeworkSurvey)
    .innerJoin(student, and(eq(student.id, homeworkSurvey.studentId), isNull(student.deletedAt)))
    .where(
      and(eq(homeworkSurvey.teacherId, teacherId), whose(homeworkSurvey), eq(homeworkSurvey.status, "answered"), since ? gte(homeworkSurvey.answeredAt, since) : undefined),
    );

  const funs: { a: string; b: string; answer: string; titles: [string, string] }[] = [];
  const topics: string[] = [];
  for (const row of surveys) {
    const questions = row.questions as SurveyQuestion[];
    const answers = (row.answers as (string | null)[] | null) ?? [];
    questions.forEach((q, i) => {
      const answer = answers[i];
      if (!answer) return;
      if (q.kind === "fun") funs.push({ a: q.a.id, b: q.b.id, answer, titles: [q.a.title, q.b.title] });
      if (q.kind === "more") topics.push(answer);
    });
  }
  const ids = [...new Set(funs.flatMap((f) => [f.a, f.b]))];
  const kinds = ids.length
    ? await database
        .select({ id: libraryMaterial.id, kind: libraryMaterial.kind })
        .from(libraryMaterial)
        .where(and(eq(libraryMaterial.teacherId, teacherId), inArray(libraryMaterial.id, ids)))
    : [];
  const kindOf = new Map(kinds.map((k) => [k.id, (RATED_MATERIAL_KINDS as readonly string[]).includes(k.kind) ? (k.kind as RatedMaterialKind) : null]));
  const funAnswers: FunAnswer[] = funs.map((f) => ({
    a: kindOf.get(f.a) ?? null,
    b: kindOf.get(f.b) ?? null,
    picked: f.answer === BOTH_FUN ? "both" : f.answer === BOTH_MEH ? "neither" : f.answer === f.titles[0] ? "a" : "b",
  }));
  const rating = {
    tasks: rateTaskKinds(
      mini.map((m) => ({ answer: m.answer as TaskType | typeof ALL_KINDS_ANSWER, kinds: taskKinds(m.document as HomeworkDocument) })),
    ),
    materials: rateMaterialKinds(funAnswers),
    topics: rateTopics(topics),
  };
  return { rating, funAnswers };
}

/** «Что заходит» for one student of this teacher: all time, or the answers given from `since` (#377). */
export async function studentRating(database: Database, teacherId: string, studentId: string, since: Date | null = null): Promise<FeedbackRating> {
  return (await ratingWithPairs(database, teacherId, [studentId], since)).rating;
}

/** What the teacher's children like across students, for the general screen. */
export function ratingAcrossStudents(database: Database, teacherId: string): Promise<FeedbackRating> {
  return ratingOf(database, teacherId, null);
}

/** When «Фидбэк» of this student was last seen, by the newest answer it showed; null for none, or no such student. */
export async function feedbackSeenAt(database: Database, teacherId: string, studentId: string): Promise<Date | null> {
  const [row] = await database
    .select({ at: student.feedbackSeenAt })
    .from(student)
    .where(and(eq(student.id, studentId), eq(student.teacherId, teacherId), isNull(student.deletedAt)));
  return row?.at ?? null;
}

/**
 * «Фидбэк» came on the teacher's screen (#333) showing answers up to `upTo`,
 * the newest it showed: those are seen. A conditional write that never moves
 * the mark back, so a page loaded earlier cannot unsee what a later one
 * showed, and an answer that came after the page loaded stays new. False when
 * there is no such student.
 */
export async function seeFeedback(database: Database, teacherId: string, studentId: string, upTo: Date): Promise<boolean> {
  const own = and(eq(student.id, studentId), eq(student.teacherId, teacherId), isNull(student.deletedAt));
  await database
    .update(student)
    .set({ feedbackSeenAt: upTo })
    .where(and(own, or(isNull(student.feedbackSeenAt), lt(student.feedbackSeenAt, upTo))));
  const [found] = await database.select({ id: student.id }).from(student).where(own);
  return found !== undefined;
}

/** «Новый фидбэк»: this teacher's students with an answer newer than the newest «Фидбэк» showed her, by first name. */
export async function studentsWithNewFeedback(database: Database, teacherId: string): Promise<{ id: string; firstName: string }[]> {
  // The page holds an answer's time in milliseconds: compared at that precision, the answer it showed is not newer than itself.
  const after = (at: typeof homeworkFeedback.createdAt | typeof homeworkSurvey.answeredAt) =>
    or(isNull(student.feedbackSeenAt), gt(sql`date_trunc('milliseconds', ${at})`, student.feedbackSeenAt));
  return database
    .select({ id: student.id, firstName: student.firstName })
    .from(student)
    .where(
      and(
        eq(student.teacherId, teacherId),
        isNull(student.deletedAt),
        or(
          sql`exists (${database
            .select({ one: sql`1` })
            .from(homeworkFeedback)
            .where(and(eq(homeworkFeedback.studentId, student.id), isNotNull(homeworkFeedback.answer), after(homeworkFeedback.createdAt)))})`,
          sql`exists (${database
            .select({ one: sql`1` })
            .from(homeworkSurvey)
            .where(and(eq(homeworkSurvey.studentId, student.id), eq(homeworkSurvey.status, "answered"), after(homeworkSurvey.answeredAt)))})`,
        ),
      ),
    )
    .orderBy(student.firstName);
}

/** At most this many «А ещё я хочу…» texts go to the assistant, the newest first. */
export const CONTEXT_WISHES = 5;

/**
 * The child's feedback for the assistant's student context (#335): «что
 * заходит» as the card rates it, the kinds in pairs answered «Оба так себе», the topics whose latest «Насколько понятно»
 * is «пока путаюсь», and the latest «А ещё я хочу…» texts.
 */
export async function feedbackForAssistant(database: Database, teacherId: string, studentId: string) {
  const { rating, funAnswers } = await ratingWithPairs(database, teacherId, [studentId]);
  const surveys = await database
    .select({ questions: homeworkSurvey.questions, answers: homeworkSurvey.answers })
    .from(homeworkSurvey)
    .where(and(eq(homeworkSurvey.teacherId, teacherId), eq(homeworkSurvey.studentId, studentId), eq(homeworkSurvey.status, "answered")))
    .orderBy(desc(homeworkSurvey.answeredAt));
  const latestClarity = new Map<string, string>();
  const wishes: string[] = [];
  for (const row of surveys) {
    const questions = row.questions as SurveyQuestion[];
    const answers = (row.answers as (string | null)[] | null) ?? [];
    questions.forEach((q, i) => {
      const answer = answers[i];
      if (!answer) return;
      // Newest first: the first answer met for a topic is its latest.
      if (q.kind === "clear" && !latestClarity.has(q.topic)) latestClarity.set(q.topic, answer);
      if (q.kind === "wish" && wishes.length < CONTEXT_WISHES) wishes.push(answer);
    });
  }
  return {
    lessonMaterials: rating.materials.map((r) => ({ kind: r.key, chosen: r.chosen, of: r.of })),
    // «Оба так себе» names no kind, so the ratings leave it out; the assistant gets it as its own list.
    lessonMaterialsMeh: rateMehKinds(funAnswers).map((r) => ({ kind: r.key, meh: r.meh, of: r.of })),
    homeworkTasks: rating.tasks.map((r) => ({ kind: r.key, chosen: r.chosen, of: r.of })),
    topics: rating.topics,
    struggling: [...latestClarity].filter(([, answer]) => answer === STRUGGLING).map(([topic]) => topic),
    wishes,
  };
}
