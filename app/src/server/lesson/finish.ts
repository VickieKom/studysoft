// «Завершить урок» (#154, architecture: `finishLesson`): one form at the end
// of a lesson. The lesson held and charged as in #82, the note, the book
// lesson covered, the lesson's homework published, and the words — those of
// the book lesson and those noted on the panel — added to the student's
// vocabulary. Applied in one transaction or not at all.
//
// Locks follow AGENTS.md: the homework, then the student, then the lesson.
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { todayIn } from "../../domain/homework";
import type { LessonPlan } from "../../domain/lesson-plan";
import { type LessonWord, lessonStateSchema } from "../../domain/lesson-state";
import { addDays, dateIn } from "../../domain/schedule";
import type { Database } from "../db/client";
import { homework, lesson, lessonPlan, lessonState, student, vocabularyWord } from "../db/schema";
import { orderedLessons, passedLesson, studentWithTextbook } from "./prep";

/** Without a next lesson, the homework is due this many days on. */
export const DEFAULT_DUE_DAYS = 7;

const revision = sql<string>`md5(${homework.document}::text)`;

/** A scheduled lesson of this teacher with its student's time zone. */
async function scheduledLesson(db: Database, teacherId: string, lessonId: string) {
  const [row] = await db
    .select({
      id: lesson.id,
      studentId: lesson.studentId,
      startsAt: lesson.startsAt,
      movedFrom: lesson.movedFrom,
      kind: lesson.kind,
      timeZone: student.timeZone,
    })
    .from(lesson)
    .innerJoin(student, and(eq(student.id, lesson.studentId), sql`${student.deletedAt} is null`))
    .where(and(eq(lesson.id, lessonId), eq(lesson.teacherId, teacherId), eq(lesson.status, "scheduled")));
  return row ?? null;
}

/** The lesson's kept state and note, if the lesson mode has opened it. */
async function keptState(db: Database, lessonId: string) {
  const [row] = await db.select({ state: lessonState.state, note: lessonState.note }).from(lessonState).where(eq(lessonState.lessonId, lessonId));
  const parsed = row ? lessonStateSchema.safeParse(row.state) : null;
  return { state: parsed?.success ? parsed.data : null, note: row?.note ?? "" };
}

/**
 * What the form opens with: the book lessons to choose from and the one the
 * lesson covered (its last book stage), the homework attached in the
 * preparation if it is still a draft, its deadline (the student's next
 * lesson, else a week on), the note and the words of the panel. Null when
 * there is no such scheduled lesson of hers.
 */
export async function finishForm(db: Database, teacherId: string, lessonId: string) {
  const found = await scheduledLesson(db, teacherId, lessonId);
  if (!found) return null;
  const withBook = await studentWithTextbook(db, teacherId, found.studentId);
  const lessons = orderedLessons(withBook?.structure ?? null);
  const { state, note } = await keptState(db, lessonId);
  const [plan] = await db.select({ plan: lessonPlan.plan, homeworkId: lessonPlan.homeworkId }).from(lessonPlan).where(eq(lessonPlan.lessonId, lessonId));
  const stages: { type: string; lessonId?: string }[] = state?.stages ?? (plan?.plan as LessonPlan | null)?.stages ?? [];
  const lastBook = stages.findLast((s) => s.type === "book")?.lessonId ?? null;

  const [attached] = plan?.homeworkId
    ? await db
        .select({ id: homework.id, title: homework.title, revision })
        .from(homework)
        .where(and(eq(homework.id, plan.homeworkId), eq(homework.teacherId, teacherId), eq(homework.studentId, found.studentId), eq(homework.status, "draft")))
    : [];
  const [next] = await db
    .select({ startsAt: lesson.startsAt })
    .from(lesson)
    .where(and(eq(lesson.teacherId, teacherId), eq(lesson.studentId, found.studentId), eq(lesson.status, "scheduled"), gt(lesson.startsAt, found.startsAt)))
    .orderBy(asc(lesson.startsAt))
    .limit(1);
  const today = todayIn(found.timeZone);
  const dueDate = next ? dateIn(next.startsAt, found.timeZone) : addDays(today, DEFAULT_DUE_DAYS);

  return {
    lessonId,
    studentId: found.studentId,
    lessons,
    bookLessonId: lastBook && lessons.some((l) => l.id === lastBook) ? lastBook : null,
    charged: found.kind !== "intro",
    intro: found.kind === "intro",
    homework: attached ? { ...attached, dueDate: dueDate < today ? today : dueDate } : null,
    note,
    words: state?.words ?? [],
  };
}

export type FinishInput = {
  charged: boolean;
  note: string;
  /** The book lesson covered, or null for «Учебник не проходили». */
  bookLessonId: string | null;
  /** The homework attached, as the form showed it; null to publish none. */
  homework: { id: string; revision: string; dueDate: string } | null;
  words: LessonWord[];
};

export type FinishResult = { finished: { studentId: string } } | "not_found" | "homework_changed" | "past" | { error: string };

/**
 * «Завершить урок». Every consequence in one transaction: the homework
 * published (the student's unsubmitted one closed as in #34), the lesson held,
 * charged as chosen (never an introductory one) and — finished before its
 * time — moved to when it really started, the passed book lesson set, the
 * words added to the vocabulary. A homework changed since the form was
 * opened, or a lesson finished meanwhile, applies nothing.
 */
export async function finishLesson(
  db: Database,
  teacherId: string,
  lessonId: string,
  input: FinishInput,
  now: Date = new Date(),
): Promise<FinishResult> {
  const found = await scheduledLesson(db, teacherId, lessonId);
  if (!found) return "not_found";
  const withBook = await studentWithTextbook(db, teacherId, found.studentId);
  const lessons = orderedLessons(withBook?.structure ?? null);
  const covered = input.bookLessonId ? lessons.find((l) => l.id === input.bookLessonId) : null;
  if (input.bookLessonId && !covered) return { error: "Такого урока нет в учебнике ученика" };
  const bookWords = covered
    ? (withBook?.structure?.units.flatMap((u) => u.lessons).find((l) => l.id === covered.id)?.words ?? [])
    : [];
  // The passed lesson stays as it was when the book was not covered.
  const passed = covered ? covered.id : await passedLesson(db, teacherId, found.studentId);
  const { state } = await keptState(db, lessonId);
  // Finished before its time: it started when the lesson mode opened, or now.
  const started = state ? new Date(state.startedAt) : now;
  const startsAt = found.startsAt > now ? (started < now ? started : now) : found.startsAt;

  return db.transaction(async (tx): Promise<FinishResult> => {
    if (input.homework) {
      const [draft] = await tx
        .select({ revision })
        .from(homework)
        .where(
          and(
            eq(homework.id, input.homework.id),
            eq(homework.teacherId, teacherId),
            eq(homework.studentId, found.studentId),
            eq(homework.status, "draft"),
          ),
        )
        .for("update");
      if (!draft || draft.revision !== input.homework.revision) return "homework_changed";
    }
    await tx.select({ id: student.id }).from(student).where(eq(student.id, found.studentId)).for("update");
    const [held] = await tx
      .select({ id: lesson.id })
      .from(lesson)
      .where(and(eq(lesson.id, lessonId), eq(lesson.teacherId, teacherId), eq(lesson.status, "scheduled")))
      .for("update");
    if (!held) return "not_found";

    if (input.homework) {
      if (input.homework.dueDate < todayIn(found.timeZone, now)) return "past";
      await tx
        .update(homework)
        .set({ status: "missed" })
        .where(and(eq(homework.studentId, found.studentId), eq(homework.teacherId, teacherId), eq(homework.status, "published")));
      await tx
        .update(homework)
        .set({ status: "published", dueDate: input.homework.dueDate, publishedAt: now })
        .where(eq(homework.id, input.homework.id));
    }

    await tx
      .update(lesson)
      .set({
        status: "held",
        charged: found.kind === "intro" ? false : input.charged,
        unit: covered?.label ?? null,
        note: input.note.trim() || null,
        ...(startsAt.getTime() !== found.startsAt.getTime() ? { startsAt, movedFrom: found.movedFrom ?? found.startsAt } : {}),
        updatedAt: now,
      })
      .where(eq(lesson.id, lessonId));
    await tx.update(lessonState).set({ note: input.note }).where(eq(lessonState.lessonId, lessonId));

    // Set with the lesson's own moment, so this held lesson's plan does not override it (prep.passedLesson):
    // the lesson chosen in the form, or — the book not covered — the one passed before, even none.
    await tx.update(student).set({ passedLessonId: passed, passedLessonSetAt: now }).where(eq(student.id, found.studentId));

    const words = [...bookWords.map((word) => ({ word, translation: "" })), ...input.words];
    for (const { word, translation } of words) {
      // The unique key is on lower(word), which the query builder cannot name as a conflict target.
      await tx.execute(sql`
        insert into ${vocabularyWord} (teacher_id, student_id, word, translation, lesson_id)
        values (${teacherId}, ${found.studentId}, ${word.trim()}, ${translation.trim() || null}, ${lessonId})
        on conflict (student_id, lower(word))
        do update set translation = coalesce(${vocabularyWord.translation}, excluded.translation), updated_at = ${now.toISOString()}`);
    }
    return { finished: { studentId: found.studentId } };
  });
}
