// «Подготовка» (#151): the plan of a student's upcoming lesson by stages, the
// next lesson of their textbook proposed, the assistant's draft, and the
// homework draft prepared for the lesson. A lesson is «подготовлен» once the
// teacher has saved or approved its plan. The assistant only drafts
// (AGENTS.md, rule 5); approving is the teacher's.
import { gamesForStudent } from "../library/material-students";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { CANDIDATE_STATUS } from "../../domain/student";
import { type LessonPlan, lessonPlanSchema, STAGE_MATERIAL_KINDS, withWaitingHomework } from "../../domain/lesson-plan";
import type { TextbookStructure } from "../../domain/textbook-structure";
import type { Database } from "../db/client";
import { openedFromLesson, stageFits, textbookLessonVideos } from "../library/textbook-videos";
import { homework, lesson, lessonPlan, libraryMaterial, student, textbook } from "../db/schema";
import { studentHomeworkIds, waitingHomework } from "./homework";

/** How far ahead «Подготовка» lists lessons: two weeks. */
const UPCOMING_DAYS = 14;

/** The lessons of a confirmed structure in the book's order, each with its unit for a label: «Unit 1 · 1.2». */
export function orderedLessons(structure: TextbookStructure | null): { id: string; label: string; title: string }[] {
  return (structure?.units ?? []).flatMap((unit) =>
    unit.lessons.map((l) => ({ id: l.id!, label: `${unit.title} · ${l.title}`, title: l.title })),
  );
}

/** A student of this teacher with their textbook's confirmed structure, or null. */
export async function studentWithTextbook(db: Database, teacherId: string, studentId: string) {
  const [row] = await db
    .select({
      id: student.id,
      firstName: student.firstName,
      textbookId: student.textbookId,
      passedLessonId: student.passedLessonId,
      passedLessonSetAt: student.passedLessonSetAt,
      structure: textbook.structure,
      textbookTitle: textbook.title,
    })
    .from(student)
    .leftJoin(textbook, and(eq(textbook.id, student.textbookId), eq(textbook.teacherId, teacherId)))
    .where(and(eq(student.id, studentId), eq(student.teacherId, teacherId), isNull(student.deletedAt)));
  return row ? { ...row, structure: (row.structure as TextbookStructure | null) ?? null } : null;
}

/** The student's textbook block on the card: the chosen textbook, the passed lesson, and the choices. */
export async function studentTextbook(db: Database, teacherId: string, studentId: string) {
  const found = await studentWithTextbook(db, teacherId, studentId);
  if (!found) return null;
  const textbooks = await db
    .select({ id: textbook.id, title: textbook.title, structure: textbook.structure })
    .from(textbook)
    .where(eq(textbook.teacherId, teacherId))
    .orderBy(asc(textbook.title));
  return {
    textbookId: found.textbookId,
    passedLessonId: await passedLesson(db, teacherId, studentId),
    // Each textbook with its confirmed lessons, so the card offers the lessons of the one chosen.
    textbooks: textbooks.map((t) => ({ id: t.id, title: t.title, lessons: orderedLessons(t.structure as TextbookStructure | null) })),
  };
}

/**
 * Sets the student's textbook and, optionally, the lesson of it passed so
 * far (product owner, 2026-11-18: chosen on the card). Returns an error to
 * show, or "not_found".
 */
export async function setStudentTextbook(
  db: Database,
  teacherId: string,
  studentId: string,
  textbookId: string | null,
  passedLessonId: string | null,
): Promise<"saved" | "not_found" | { error: string }> {
  if (!(await studentWithTextbook(db, teacherId, studentId))) return "not_found";
  if (textbookId) {
    const [book] = await db
      .select({ structure: textbook.structure })
      .from(textbook)
      .where(and(eq(textbook.id, textbookId), eq(textbook.teacherId, teacherId)));
    if (!book) return { error: "Такого учебника нет" };
    if (passedLessonId && !orderedLessons(book.structure as TextbookStructure | null).some((l) => l.id === passedLessonId)) {
      return { error: "Такого урока нет в учебнике" };
    }
  } else if (passedLessonId) return { error: "Сначала выберите учебник" };
  await db
    .update(student)
    .set({ textbookId, passedLessonId, passedLessonSetAt: passedLessonId ? new Date() : null })
    .where(and(eq(student.id, studentId), eq(student.teacherId, teacherId)));
  return "saved";
}

/**
 * The lesson of the student's textbook passed so far: the book lesson in the
 * plan of their latest held lesson, or the one set on the card, whichever was
 * recorded later — the held lesson when it was marked (product owner,
 * 2026-11-18). Null when neither is.
 */
export async function passedLesson(db: Database, teacherId: string, studentId: string): Promise<string | null> {
  const found = await studentWithTextbook(db, teacherId, studentId);
  if (!found?.textbookId) return null;
  const known = new Set(orderedLessons(found.structure).map((l) => l.id));
  const held = await db
    .select({ markedAt: lesson.updatedAt, plan: lessonPlan.plan })
    .from(lesson)
    .innerJoin(lessonPlan, eq(lessonPlan.lessonId, lesson.id))
    .where(and(eq(lesson.teacherId, teacherId), eq(lesson.studentId, studentId), eq(lesson.status, "held")))
    .orderBy(desc(lesson.startsAt));
  for (const row of held) {
    const book = (row.plan as LessonPlan | null)?.stages.findLast((s) => s.type === "book");
    if (book?.type !== "book" || !known.has(book.lessonId)) continue;
    // The latest held lesson with a book stage, unless the card was set after it was marked.
    if (!found.passedLessonSetAt || row.markedAt > found.passedLessonSetAt) return book.lessonId;
    break;
  }
  return found.passedLessonId && known.has(found.passedLessonId) ? found.passedLessonId : null;
}

/** The lesson after the passed one in the book's order; the first one when none is passed. Null at the end or without a structure. */
export async function nextBookLesson(db: Database, teacherId: string, studentId: string) {
  const found = await studentWithTextbook(db, teacherId, studentId);
  if (!found?.textbookId) return null;
  const lessons = orderedLessons(found.structure);
  const passed = await passedLesson(db, teacherId, studentId);
  const at = passed ? lessons.findIndex((l) => l.id === passed) + 1 : 0;
  return lessons[at] ?? null;
}

/** This teacher's lessons from an hour ago to two weeks ahead, still to hold, each «подготовлен» or not; optionally one student's. */
export async function upcomingLessons(
  db: Database,
  teacherId: string,
  studentId?: string,
  now: Date = new Date(),
  // The assistant does not see a request's hidden card (#338): it has no context for it.
  { introCards = true }: { introCards?: boolean } = {},
) {
  const rows = await db
    .select({
      id: lesson.id,
      studentId: lesson.studentId,
      firstName: student.firstName,
      startsAt: lesson.startsAt,
      durationMinutes: lesson.durationMinutes,
      prepared: sql<boolean>`${lessonPlan.plan} is not null`,
      draft: sql<boolean>`${lessonPlan.draft} is not null`,
    })
    .from(lesson)
    .innerJoin(student, and(eq(student.id, lesson.studentId), isNull(student.deletedAt)))
    .leftJoin(lessonPlan, eq(lessonPlan.lessonId, lesson.id))
    .where(
      and(
        eq(lesson.teacherId, teacherId),
        eq(lesson.status, "scheduled"),
        gte(lesson.startsAt, new Date(now.getTime() - 3_600_000)),
        lte(lesson.startsAt, new Date(now.getTime() + UPCOMING_DAYS * 86_400_000)),
        studentId ? eq(lesson.studentId, studentId) : undefined,
        introCards ? undefined : ne(student.status, CANDIDATE_STATUS),
      ),
    )
    .orderBy(asc(lesson.startsAt));
  return rows;
}

/** Whether a lesson of this teacher is on a request's hidden card (#338), which the assistant does not see. */
export async function onIntroCard(db: Database, teacherId: string, lessonId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: lesson.id })
    .from(lesson)
    .innerJoin(student, eq(student.id, lesson.studentId))
    .where(and(eq(lesson.id, lessonId), eq(lesson.teacherId, teacherId), eq(student.status, CANDIDATE_STATUS)));
  return row !== undefined;
}

/** A lesson of this teacher still to hold, with its student. */
export async function ownLesson(db: Database, teacherId: string, lessonId: string) {
  const [row] = await db
    .select({ id: lesson.id, studentId: lesson.studentId, startsAt: lesson.startsAt, durationMinutes: lesson.durationMinutes })
    .from(lesson)
    .innerJoin(student, and(eq(student.id, lesson.studentId), isNull(student.deletedAt)))
    .where(and(eq(lesson.id, lessonId), eq(lesson.teacherId, teacherId), eq(lesson.status, "scheduled")));
  return row ?? null;
}

/** The materials a plan may take: this teacher's warm-ups, games and videos. */
export async function stageMaterials(db: Database, teacherId: string) {
  return db
    .select({ id: libraryMaterial.id, kind: libraryMaterial.kind, title: libraryMaterial.title, level: libraryMaterial.level, topics: libraryMaterial.topics })
    .from(libraryMaterial)
    .where(and(eq(libraryMaterial.teacherId, teacherId), inArray(libraryMaterial.kind, [...STAGE_MATERIAL_KINDS])))
    .orderBy(asc(libraryMaterial.title));
}

/** The plan checked against the student's textbook and this teacher's library: the plan, or the problems in words. */
async function checkPlan(
  db: Database,
  teacherId: string,
  studentId: string,
  input: unknown,
): Promise<{ ok: true; plan: LessonPlan } | { ok: false; errors: string[] }> {
  const parsed = lessonPlanSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.slice(0, 10).map((i) => `${i.path.length > 0 ? `${i.path.join(".")}: ` : ""}${i.message}`) };
  }
  const found = await studentWithTextbook(db, teacherId, studentId);
  const lessons = new Set(orderedLessons(found?.structure ?? null).map((l) => l.id));
  const materials = new Set((await stageMaterials(db, teacherId)).map((m) => m.id));
  const ownHomework = await studentHomeworkIds(
    db,
    teacherId,
    studentId,
    parsed.data.stages.flatMap((s) => (s.type === "homework" ? [s.homeworkId] : [])),
  );
  const videos = found?.textbookId ? await textbookLessonVideos(db, found.textbookId, found.structure) : [];
  const errors = parsed.data.stages.flatMap((s, i) =>
    s.type === "textbook_video" && stageFits(videos.find((v) => v.fileId === s.fileId && v.lessonId === s.lessonId), s) !== "fits"
      ? stageFits(videos.find((v) => v.fileId === s.fileId && v.lessonId === s.lessonId), s) === "no_video"
        ? [`этап ${i + 1}: такого видео нет в уроке учебника ученика`]
        : [`этап ${i + 1}: задания урока учебника изменились — отметьте задания к видео заново`]
      : s.type === "book" && !lessons.has(s.lessonId)
      ? [`этап ${i + 1}: такого урока нет в учебнике ученика`]
      : s.type === "material" && !materials.has(s.materialId)
        ? [`этап ${i + 1}: такого материала нет в библиотеке`]
        : s.type === "homework" && !ownHomework.has(s.homeworkId)
          ? [`этап ${i + 1}: такой домашки у ученика нет`]
          : [],
  );
  return errors.length > 0 ? { ok: false, errors } : { ok: true, plan: parsed.data };
}

/** The titles of the student's homework with these ids. */
async function homeworkTitles(db: Database, teacherId: string, studentId: string, ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .select({ id: homework.id, title: homework.title })
    .from(homework)
    .where(and(eq(homework.teacherId, teacherId), eq(homework.studentId, studentId), inArray(homework.id, ids)));
}

/** The draft as the teacher's page loaded it: approving is refused when the assistant replaced it meanwhile. */
const draftRevision = sql<string>`md5(coalesce(${lessonPlan.draft}::text, ''))`;

/**
 * A lesson's preparation for the teacher: the lesson and its student, the
 * approved plan, the assistant's draft, the plan proposed when there is
 * neither (the review of a waiting homework, then the next book lesson), the
 * homework draft attached, and the choices — the textbook's lessons, the
 * library, the student's homework drafts. `start` is the plan the page opens
 * with: the draft, the approved plan or the proposed one, with the waiting
 * homework's stage first unless the teacher saved the plan after it was
 * submitted (#153).
 */
export async function findPreparation(db: Database, teacherId: string, lessonId: string) {
  const found = await ownLesson(db, teacherId, lessonId);
  if (!found) return null;
  const withBook = (await studentWithTextbook(db, teacherId, found.studentId))!;
  const [row] = await db
    .select({
      plan: lessonPlan.plan,
      draft: lessonPlan.draft,
      homeworkId: lessonPlan.homeworkId,
      revision: draftRevision,
      savedAt: lessonPlan.updatedAt,
    })
    .from(lessonPlan)
    .where(eq(lessonPlan.lessonId, lessonId));
  const next = await nextBookLesson(db, teacherId, found.studentId);
  const waiting = await waitingHomework(db, teacherId, found.studentId);
  const proposed = withWaitingHomework(
    { stages: next ? [{ type: "book", lessonId: next.id, skip: "", minutes: found.durationMinutes }] : [] },
    waiting,
    null,
  );
  const plan = (row?.plan as LessonPlan | null) ?? null;
  const draft = (row?.draft as LessonPlan | null) ?? null;
  // A saved plan's moment: the teacher's last save; the assistant's drafts leave `updated_at` as it was.
  const fromPlan = plan ? withWaitingHomework(plan, waiting, row!.savedAt) : null;
  const start = draft ? withWaitingHomework(draft, waiting, null) : (fromPlan ?? proposed);
  const drafts = await db
    .select({ id: homework.id, title: homework.title })
    .from(homework)
    .where(and(eq(homework.teacherId, teacherId), eq(homework.studentId, found.studentId), eq(homework.status, "draft")))
    .orderBy(desc(homework.createdAt));
  return {
    lessonId,
    studentId: found.studentId,
    firstName: withBook.firstName,
    startsAt: found.startsAt,
    durationMinutes: found.durationMinutes,
    textbookTitle: withBook.textbookTitle,
    // For the book stage's link to the lesson's page (#415).
    textbookId: withBook.textbookTitle ? withBook.textbookId : null,
    plan,
    draft,
    revision: row?.revision ?? "",
    proposed,
    start,
    // What «Запустить урок» starts from: the approved plan, else the proposed one — never the assistant's draft.
    launch: fromPlan ?? proposed,
    waitingHomework: waiting ? { id: waiting.id, title: waiting.title } : null,
    // The homework the plan's stages review, for their titles.
    stageHomework: await homeworkTitles(
      db,
      teacherId,
      found.studentId,
      [...new Set([plan, draft, start].flatMap((p) => p?.stages ?? []).flatMap((st) => (st.type === "homework" ? [st.homeworkId] : [])))],
    ),
    homeworkId: row?.homeworkId ?? null,
    lessons: orderedLessons(withBook.structure),
    // The textbook's lesson videos the plan may take (#329), each with its lesson's bank tasks fit for a video by position and prompt, and those already opened.
    textbookVideos: (withBook.textbookId ? await textbookLessonVideos(db, withBook.textbookId, withBook.structure) : []).map((v) => ({
      fileId: v.fileId,
      name: v.name,
      lessonId: v.lessonId,
      lessonTitle: v.lessonTitle,
      tasks: v.tasks.map((t) => ({ index: t.index, prompt: t.task.prompt })),
      revision: v.revision,
    })),
    openedVideos: [...(await openedFromLesson(db, teacherId, lessonId))],
    materials: await prepMaterials(db, teacherId, found.studentId),
    homeworkDrafts: drafts,
  };
}

/**
 * The materials a plan may take, each game with whether it is made for this
 * student (#292) and its textbook lesson (#291), for the order the prep
 * offers them in (#293, `domain/prep-materials.ts`).
 */
async function prepMaterials(db: Database, teacherId: string, studentId: string) {
  const listed = await stageMaterials(db, teacherId);
  const links = await db
    .select({ id: libraryMaterial.id, textbookLessonId: libraryMaterial.textbookLessonId })
    .from(libraryMaterial)
    .where(and(eq(libraryMaterial.teacherId, teacherId), eq(libraryMaterial.kind, "game")));
  const lessonOf = new Map(links.map((l) => [l.id, l.textbookLessonId]));
  const forStudent = new Set((await gamesForStudent(db, teacherId, studentId)).map((g) => g.id));
  return listed.map((m) => ({ ...m, forStudent: forStudent.has(m.id), textbookLessonId: lessonOf.get(m.id) ?? null }));
}

type Saved = "saved" | "not_found" | "conflict" | { errors: string[] };

/**
 * The teacher saves or approves a plan, with the homework draft prepared for
 * the lesson (or none): the lesson is «подготовлен», the assistant's draft
 * cleared. Refused as a conflict when the draft changed since her page
 * loaded it (`revision`, "" when there was none).
 */
export async function savePlan(
  db: Database,
  teacherId: string,
  lessonId: string,
  input: unknown,
  homeworkId: string | null,
  revision: string,
): Promise<Saved> {
  const found = await ownLesson(db, teacherId, lessonId);
  if (!found) return "not_found";
  const checked = await checkPlan(db, teacherId, found.studentId, input);
  if (!checked.ok) return { errors: checked.errors };
  if (homeworkId) {
    const [draft] = await db
      .select({ id: homework.id })
      .from(homework)
      .where(and(eq(homework.id, homeworkId), eq(homework.teacherId, teacherId), eq(homework.studentId, found.studentId), eq(homework.status, "draft")));
    if (!draft) return { errors: ["Домашка к уроку — черновик этого ученика"] };
  }
  const expected = revision === "" ? sql`md5('')` : sql`${revision}`;
  const rows = await db
    .insert(lessonPlan)
    .values({ lessonId, teacherId, plan: checked.plan, draft: null, homeworkId })
    .onConflictDoUpdate({
      target: lessonPlan.lessonId,
      set: { plan: checked.plan, draft: null, homeworkId, updatedAt: sql`now()` },
      setWhere: and(eq(lessonPlan.teacherId, teacherId), sql`${draftRevision} = ${expected}`),
    })
    .returning({ lessonId: lessonPlan.lessonId });
  return rows.length > 0 ? "saved" : "conflict";
}

/** The assistant's plan for a lesson, kept as a draft beside the approved plan until the teacher approves it. */
export async function saveAssistantPlan(db: Database, teacherId: string, lessonId: string, input: unknown): Promise<Saved> {
  const found = await ownLesson(db, teacherId, lessonId);
  if (!found) return "not_found";
  const checked = await checkPlan(db, teacherId, found.studentId, input);
  if (!checked.ok) return { errors: checked.errors };
  await db
    .insert(lessonPlan)
    .values({ lessonId, teacherId, draft: checked.plan })
    // `updated_at` stays the teacher's last save: a homework submitted after it is still added at launch (#153).
    .onConflictDoUpdate({
      target: lessonPlan.lessonId,
      set: { draft: checked.plan, updatedAt: sql`${lessonPlan.updatedAt}` },
      setWhere: eq(lessonPlan.teacherId, teacherId),
    });
  return "saved";
}
