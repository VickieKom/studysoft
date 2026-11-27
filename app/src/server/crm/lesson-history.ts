// The latest past lessons in the student context (#424): what the assistant
// reads before drafting the next plan, so it does not repeat yesterday's
// warm-up and picks up what the student struggled with. A lesson's note was
// the teacher's only (#82); the product owner opened it to her assistant on
// 2026-11-26. The student and the parent still never see it.
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/client";
import { homework, lesson, lessonPlan, lessonState, libraryMaterial, textbook, textbookFile, vocabularyWord } from "../db/schema";
import { type LessonPlan, lessonPlanSchema } from "../../domain/lesson-plan";
import { orderedLessons, studentWithTextbook } from "../lesson/prep";

/** How many of the latest past lessons the context carries. */
export const CONTEXT_LESSONS = 5;

/** The statuses of a lesson that took its place: held or missed; a cancelled one never came. */
const PAST_STATUSES = ["held", "missed"] as const;

/** A stage of the lesson's plan as the assistant reads it; the title is null when its material or homework is gone. */
export type PastStage = { kind: string; title: string | null; skip?: string };

export type PastLesson = {
  startsAt: Date;
  status: (typeof PAST_STATUSES)[number];
  intro: boolean;
  /** The book lesson covered, as written when the lesson was finished or marked. */
  bookLesson: string | null;
  /** The approved plan's stages; none for a lesson that was never prepared. */
  stages: PastStage[];
  /** The note written when the lesson was marked or finished, else the panel's. */
  note: string | null;
  /** The words the lesson added to the vocabulary. */
  words: string[];
};

/** The student's latest held or missed lessons, newest first. The caller has checked the student is this teacher's. */
export async function recentLessons(db: Database, teacherId: string, studentId: string, limit = CONTEXT_LESSONS): Promise<PastLesson[]> {
  const rows = await db
    .select({
      id: lesson.id,
      startsAt: lesson.startsAt,
      status: lesson.status,
      kind: lesson.kind,
      unit: lesson.unit,
      note: lesson.note,
      plan: lessonPlan.plan,
      panelNote: lessonState.note,
    })
    .from(lesson)
    .leftJoin(lessonPlan, eq(lessonPlan.lessonId, lesson.id))
    .leftJoin(lessonState, eq(lessonState.lessonId, lesson.id))
    .where(and(eq(lesson.teacherId, teacherId), eq(lesson.studentId, studentId), inArray(lesson.status, PAST_STATUSES)))
    .orderBy(desc(lesson.startsAt))
    .limit(limit);
  if (rows.length === 0) return [];

  const plans = new Map(rows.map((r) => [r.id, parsedPlan(r.plan)]));
  const titles = await stageTitles(db, teacherId, studentId, [...plans.values()]);
  const words = await db
    .select({ lessonId: vocabularyWord.lessonId, word: vocabularyWord.word })
    .from(vocabularyWord)
    .where(
      and(
        eq(vocabularyWord.teacherId, teacherId),
        eq(vocabularyWord.studentId, studentId),
        inArray(
          vocabularyWord.lessonId,
          rows.map((r) => r.id),
        ),
      ),
    )
    .orderBy(vocabularyWord.createdAt);

  return rows.map((r) => ({
    startsAt: r.startsAt,
    status: r.status as PastLesson["status"],
    intro: r.kind === "intro",
    bookLesson: r.unit,
    stages: (plans.get(r.id)?.stages ?? []).map((s): PastStage => {
      switch (s.type) {
        case "book":
          return { kind: "book", title: titles.bookLessons.get(s.lessonId) ?? null, ...(s.skip ? { skip: s.skip } : {}) };
        case "material": {
          const material = titles.materials.get(s.materialId);
          return { kind: material?.kind ?? "material", title: material?.title ?? null };
        }
        case "homework":
          return { kind: "homework", title: titles.homework.get(s.homeworkId) ?? null };
        case "textbook_video":
          return { kind: "textbook_video", title: titles.videos.get(s.fileId) ?? null };
      }
    }),
    note: r.note ?? (r.panelNote?.trim() ? r.panelNote : null),
    words: words.filter((w) => w.lessonId === r.id).map((w) => w.word),
  }));
}

/** A stored plan, or null when none was approved (a plan saved before a change of the format is read as none). */
function parsedPlan(plan: unknown): LessonPlan | null {
  if (plan === null) return null;
  const parsed = lessonPlanSchema.safeParse(plan);
  return parsed.success ? parsed.data : null;
}

/** The titles the stages name, looked up once for all the plans: only this teacher's rows. */
async function stageTitles(db: Database, teacherId: string, studentId: string, plans: (LessonPlan | null)[]) {
  const stages = plans.flatMap((p) => p?.stages ?? []);
  const materialIds = [...new Set(stages.flatMap((s) => (s.type === "material" ? [s.materialId] : [])))];
  const homeworkIds = [...new Set(stages.flatMap((s) => (s.type === "homework" ? [s.homeworkId] : [])))];
  const fileIds = [...new Set(stages.flatMap((s) => (s.type === "textbook_video" ? [s.fileId] : [])))];

  const materials = materialIds.length
    ? await db
        .select({ id: libraryMaterial.id, kind: libraryMaterial.kind, title: libraryMaterial.title })
        .from(libraryMaterial)
        .where(and(eq(libraryMaterial.teacherId, teacherId), inArray(libraryMaterial.id, materialIds)))
    : [];
  const homeworkRows = homeworkIds.length
    ? await db
        .select({ id: homework.id, title: homework.title })
        .from(homework)
        .where(and(eq(homework.teacherId, teacherId), eq(homework.studentId, studentId), inArray(homework.id, homeworkIds)))
    : [];
  const videos = fileIds.length
    ? await db
        .select({ id: textbookFile.id, name: textbookFile.name })
        .from(textbookFile)
        .innerJoin(textbook, eq(textbook.id, textbookFile.textbookId))
        .where(and(eq(textbook.teacherId, teacherId), inArray(textbookFile.id, fileIds)))
    : [];
  const book = await studentWithTextbook(db, teacherId, studentId);

  return {
    materials: new Map(materials.map((m) => [m.id, { kind: m.kind, title: m.title }])),
    homework: new Map(homeworkRows.map((h) => [h.id, h.title])),
    videos: new Map(videos.map((v) => [v.id, v.name])),
    bookLessons: new Map(orderedLessons(book?.structure ?? null).map((l) => [l.id, l.label])),
  };
}
