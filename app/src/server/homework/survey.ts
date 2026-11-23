// The survey about the lessons (#332), sent with a homework only when the
// teacher ticks «Опрос по урокам» in its draft. Its questions are gathered
// from the lessons held since the student's previous survey, no further back
// than two weeks, the first one over the last week: pairs of the lessons'
// materials, «Про что хочется ещё?» between topics and «Насколько понятно»
// per topic — the topics of the period's materials and homework tasks, at
// most three (product owner, 2026-11-23) — and «А ещё я хочу…». The teacher
// removes questions and adds her own in the draft. On the child's page it
// comes first, until answered or skipped; any question may be left
// unanswered. It counts for nothing, and only the teacher reads the answers.
import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import type { HomeworkDocument } from "../../domain/homework-format";
import { lessonPlanSchema } from "../../domain/lesson-plan";
import {
  fitsQuestion,
  MAX_OWN_QUESTIONS,
  MAX_PAIRS,
  MAX_TOPICS,
  questionChoices,
  questionText,
  type SurveyQuestion,
  surveyQuestionSchema,
} from "../../domain/survey";
import type { Database } from "../db/client";
import { homework, homeworkSurvey, lesson, lessonPlan, libraryMaterial } from "../db/schema";

const DAY_MS = 86_400_000;
/** The first survey covers the last week; a later one goes back to the previous survey, at most two weeks. */
export const FIRST_PERIOD_DAYS = 7;
export const MAX_PERIOD_DAYS = 14;

/** The period of a new survey of this student: from the end of the previous one sent, or the last week. */
export async function surveyPeriod(database: Pick<Database, "select">, teacherId: string, studentId: string, now: Date): Promise<{ from: Date; to: Date }> {
  const [previous] = await database
    .select({ to: homeworkSurvey.periodTo })
    .from(homeworkSurvey)
    .where(and(eq(homeworkSurvey.teacherId, teacherId), eq(homeworkSurvey.studentId, studentId), ne(homeworkSurvey.status, "draft")))
    .orderBy(desc(homeworkSurvey.periodTo))
    .limit(1);
  const earliest = new Date(now.getTime() - MAX_PERIOD_DAYS * DAY_MS);
  const from = previous ? new Date(Math.max(previous.to.getTime(), earliest.getTime())) : new Date(now.getTime() - FIRST_PERIOD_DAYS * DAY_MS);
  return { from, to: now };
}

/** Topics as typed, each once whatever its letter case, in the order they first come. */
function distinctTopics(topics: string[]): string[] {
  const seen = new Set<string>();
  return topics.filter((t) => {
    const key = t.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The questions gathered from the lessons held in the period, or null when
 * there were none: the materials of their plans in pairs, oldest first;
 * the topics of those materials and of the homework published in the period.
 */
export async function gatherQuestions(
  database: Pick<Database, "select">,
  teacherId: string,
  studentId: string,
  period: { from: Date; to: Date },
): Promise<SurveyQuestion[] | null> {
  const held = await database
    .select({ plan: lessonPlan.plan })
    .from(lesson)
    .leftJoin(lessonPlan, eq(lessonPlan.lessonId, lesson.id))
    .where(
      and(
        eq(lesson.teacherId, teacherId),
        eq(lesson.studentId, studentId),
        eq(lesson.status, "held"),
        gte(lesson.startsAt, period.from),
        lte(lesson.startsAt, period.to),
      ),
    )
    .orderBy(asc(lesson.startsAt));
  if (held.length === 0) return null;
  const ids = [
    ...new Set(
      held.flatMap(({ plan }) => {
        const parsed = lessonPlanSchema.safeParse(plan);
        return parsed.success ? parsed.data.stages.flatMap((s) => (s.type === "material" ? [s.materialId] : [])) : [];
      }),
    ),
  ];
  const rows = ids.length
    ? await database
        .select({ id: libraryMaterial.id, title: libraryMaterial.title, topics: libraryMaterial.topics })
        .from(libraryMaterial)
        .where(and(eq(libraryMaterial.teacherId, teacherId), inArray(libraryMaterial.id, ids)))
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const materials = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));

  const published = await database
    .select({ document: homework.document })
    .from(homework)
    .where(and(eq(homework.teacherId, teacherId), eq(homework.studentId, studentId), gte(homework.publishedAt, period.from), lte(homework.publishedAt, period.to)));
  const taskTopics = published.flatMap(({ document }) => (document as HomeworkDocument).tasks.flatMap((t) => (t.topic ? [t.topic] : [])));
  const topics = distinctTopics([...materials.flatMap((m) => m.topics), ...taskTopics]).slice(0, MAX_TOPICS);

  const questions: SurveyQuestion[] = [];
  for (let i = 0; i + 1 < materials.length && questions.length < MAX_PAIRS; i += 2) {
    const [a, b] = [materials[i]!, materials[i + 1]!];
    questions.push({ kind: "fun", a: { id: a.id, title: a.title }, b: { id: b.id, title: b.title } });
  }
  if (topics.length >= 2) questions.push({ kind: "more", topics });
  for (const topic of topics) questions.push({ kind: "clear", topic });
  questions.push({ kind: "wish" });
  return questions;
}

export type DraftSurvey = { questions: { text: string }[]; revision: string } | { noLessons: true } | null;

/** The draft's questions as the page shows them, with their revision. */
const revision = sql<string>`md5(${homeworkSurvey.questions}::text)`;

/** «Опрос по урокам» in a draft: its questions, or null when the box is off. */
export async function draftSurvey(database: Pick<Database, "select">, teacherId: string, homeworkId: string): Promise<DraftSurvey> {
  const [row] = await database
    .select({ questions: homeworkSurvey.questions, revision })
    .from(homeworkSurvey)
    .where(and(eq(homeworkSurvey.teacherId, teacherId), eq(homeworkSurvey.homeworkId, homeworkId)));
  if (!row) return null;
  // «Про что хочется ещё?» shows its topics in the draft, so the teacher sees what is asked.
  const shown = (q: SurveyQuestion) => (q.kind === "more" ? `${questionText(q)} ${q.topics.join(", ")}` : questionText(q));
  return { questions: (row.questions as SurveyQuestion[]).map((q) => ({ text: shown(q) })), revision: row.revision };
}

/**
 * A draft of this teacher, with its student, its row locked for the rest of
 * the transaction; null when there is none. «Опубликовать» locks the same row
 * (`publishHomework`), so a survey change lands before the publication and
 * opens with it, or finds the homework published and is refused.
 */
async function lockedDraft(tx: Pick<Database, "select">, teacherId: string, homeworkId: string) {
  const [row] = await tx
    .select({ studentId: homework.studentId })
    .from(homework)
    .where(and(eq(homework.id, homeworkId), eq(homework.teacherId, teacherId), eq(homework.status, "draft")))
    .for("update");
  return row ?? null;
}

/**
 * The box: on gathers the questions into the draft's survey — none when no
 * lesson was held in the period, and the draft says so; off removes it.
 * "not_found" when there is no such draft.
 */
export async function setSurvey(
  database: Database,
  teacherId: string,
  homeworkId: string,
  on: boolean,
  now: Date = new Date(),
): Promise<DraftSurvey | "not_found"> {
  return database.transaction(async (tx) => {
    const draft = await lockedDraft(tx, teacherId, homeworkId);
    if (!draft) return "not_found" as const;
    if (!on) {
      await tx.delete(homeworkSurvey).where(and(eq(homeworkSurvey.homeworkId, homeworkId), eq(homeworkSurvey.status, "draft")));
      return null;
    }
    const period = await surveyPeriod(tx, teacherId, draft.studentId, now);
    const questions = await gatherQuestions(tx, teacherId, draft.studentId, period);
    if (!questions) {
      await tx.delete(homeworkSurvey).where(and(eq(homeworkSurvey.homeworkId, homeworkId), eq(homeworkSurvey.status, "draft")));
      return { noLessons: true as const };
    }
    await tx
      .insert(homeworkSurvey)
      .values({ teacherId, studentId: draft.studentId, homeworkId, periodFrom: period.from, periodTo: period.to, questions })
      .onConflictDoUpdate({
        target: homeworkSurvey.homeworkId,
        set: { periodFrom: period.from, periodTo: period.to, questions, updatedAt: sql`now()` },
        setWhere: and(eq(homeworkSurvey.teacherId, teacherId), eq(homeworkSurvey.status, "draft")),
      });
    return draftSurvey(tx, teacherId, homeworkId);
  });
}

/**
 * «Убрать» or «Добавить вопрос» on the draft's questions, as the page showed
 * them (`seen`): one conditional write, so an edit from another page in
 * between is never undone. "conflict" when they changed, "not_found" when
 * the draft has no survey.
 */
export async function editSurvey(
  database: Database,
  teacherId: string,
  homeworkId: string,
  seen: string,
  edit: { remove: number } | { add: string },
): Promise<DraftSurvey | "not_found" | "conflict" | "too_many"> {
  // Under the draft's lock, as setSurvey: an edit never lands after «Опубликовать» opened the survey.
  return database.transaction(async (tx) => {
    if (!(await lockedDraft(tx, teacherId, homeworkId))) return "not_found" as const;
    const [row] = await tx
      .select({ questions: homeworkSurvey.questions, revision })
      .from(homeworkSurvey)
      .where(and(eq(homeworkSurvey.teacherId, teacherId), eq(homeworkSurvey.homeworkId, homeworkId), eq(homeworkSurvey.status, "draft")));
    if (!row) return "not_found" as const;
    if (row.revision !== seen) return "conflict" as const;
    const questions = row.questions as SurveyQuestion[];
    let next: SurveyQuestion[];
    if ("remove" in edit) {
      if (edit.remove >= questions.length) return "conflict" as const;
      next = questions.filter((_, i) => i !== edit.remove);
    } else {
      if (questions.filter((q) => q.kind === "own").length >= MAX_OWN_QUESTIONS) return "too_many" as const;
      const own = surveyQuestionSchema.parse({ kind: "own", text: edit.add.trim() });
      // Her own questions go before «А ещё я хочу…», which stays last.
      const wish = questions.findIndex((q) => q.kind === "wish");
      next = wish < 0 ? [...questions, own] : [...questions.slice(0, wish), own, ...questions.slice(wish)];
    }
    await tx.update(homeworkSurvey).set({ questions: next, updatedAt: sql`now()` }).where(and(eq(homeworkSurvey.homeworkId, homeworkId), eq(homeworkSurvey.status, "draft")));
    return draftSurvey(tx, teacherId, homeworkId);
  });
}

export type StudentSurvey = { homeworkId: string; questions: { text: string; choices: string[]; textAnswer: boolean }[] };

/** The open survey of the student's published homework, for their page; null when there is none to answer. */
export async function studentSurvey(database: Database, teacherId: string, studentId: string): Promise<StudentSurvey | null> {
  const [row] = await database
    .select({ homeworkId: homeworkSurvey.homeworkId, questions: homeworkSurvey.questions })
    .from(homeworkSurvey)
    .innerJoin(homework, eq(homework.id, homeworkSurvey.homeworkId))
    .where(
      and(
        eq(homeworkSurvey.teacherId, teacherId),
        eq(homeworkSurvey.studentId, studentId),
        eq(homeworkSurvey.status, "open"),
        eq(homework.status, "published"),
      ),
    )
    .orderBy(desc(homework.publishedAt))
    .limit(1);
  if (!row) return null;
  return {
    homeworkId: row.homeworkId,
    questions: (row.questions as SurveyQuestion[]).map((q) => {
      const choices = questionChoices(q);
      return { text: questionText(q), choices, textAnswer: choices.length === 0 };
    }),
  };
}

/**
 * «Готово» with the answers, one per question (null for none), or
 * «Пропустить» with none. One statement, conditional on the survey still
 * being open and its homework published. "invalid" when an answer does not
 * fit its question, "not_found" when there is nothing to answer.
 */
export async function answerSurvey(
  database: Database,
  teacherId: string,
  studentId: string,
  homeworkId: string,
  answers: (string | null)[] | null,
): Promise<"saved" | "not_found" | "invalid"> {
  const [row] = await database
    .select({ questions: homeworkSurvey.questions })
    .from(homeworkSurvey)
    .where(and(eq(homeworkSurvey.teacherId, teacherId), eq(homeworkSurvey.studentId, studentId), eq(homeworkSurvey.homeworkId, homeworkId), eq(homeworkSurvey.status, "open")));
  if (!row) return "not_found";
  const questions = row.questions as SurveyQuestion[];
  const kept = answers?.map((a) => (a === null || a.trim() === "" ? null : a.trim())) ?? null;
  if (kept && (kept.length !== questions.length || kept.some((a, i) => !fitsQuestion(questions[i]!, a)))) return "invalid";
  const rows = await database
    .update(homeworkSurvey)
    .set({ status: kept ? "answered" : "skipped", answers: kept, answeredAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(homeworkSurvey.homeworkId, homeworkId),
        eq(homeworkSurvey.studentId, studentId),
        eq(homeworkSurvey.status, "open"),
        sql`exists (select 1 from ${homework} where ${homework.id} = ${homeworkId} and ${homework.status} = 'published')`,
      ),
    )
    .returning({ id: homeworkSurvey.id });
  return rows.length > 0 ? "saved" : "not_found";
}

export type SurveyFeedback = { homeworkTitle: string; answeredAt: Date; answers: { question: string; answer: string }[] };

/** «Фидбэк» on the card: the answered surveys, the newest first, each question with the child's answer. */
export async function surveyFeedback(database: Database, teacherId: string, studentId: string): Promise<SurveyFeedback[]> {
  const rows = await database
    .select({ title: homework.title, questions: homeworkSurvey.questions, answers: homeworkSurvey.answers, answeredAt: homeworkSurvey.answeredAt })
    .from(homeworkSurvey)
    .innerJoin(homework, eq(homework.id, homeworkSurvey.homeworkId))
    .where(and(eq(homeworkSurvey.teacherId, teacherId), eq(homeworkSurvey.studentId, studentId), eq(homeworkSurvey.status, "answered")))
    .orderBy(desc(homeworkSurvey.answeredAt));
  return rows.map((row) => {
    const questions = row.questions as SurveyQuestion[];
    const answers = (row.answers as (string | null)[] | null) ?? [];
    return {
      homeworkTitle: row.title,
      answeredAt: row.answeredAt!,
      answers: questions.flatMap((q, i) => (answers[i] ? [{ question: questionText(q), answer: answers[i]! }] : [])),
    };
  });
}

/**
 * In «Опубликовать»'s transaction: the draft's survey opens with the
 * homework. One with every question removed asks nothing: it goes instead.
 */
export async function openSurvey(tx: Pick<Database, "update" | "delete">, homeworkId: string): Promise<void> {
  const draft = and(eq(homeworkSurvey.homeworkId, homeworkId), eq(homeworkSurvey.status, "draft"));
  await tx.delete(homeworkSurvey).where(and(draft, sql`jsonb_array_length(${homeworkSurvey.questions}) = 0`));
  await tx.update(homeworkSurvey).set({ status: "open", updatedAt: sql`now()` }).where(draft);
}

/** In «Снять с публикации»: an unanswered survey goes back with the homework. */
export async function takeBackSurvey(tx: Pick<Database, "update">, homeworkId: string): Promise<void> {
  await tx.update(homeworkSurvey).set({ status: "draft", updatedAt: sql`now()` }).where(and(eq(homeworkSurvey.homeworkId, homeworkId), eq(homeworkSurvey.status, "open")));
}
