// The lesson mode (#152): the stage for the student and the control panel
// for the teacher. What the lesson can show — the student's textbook with its
// rendered books, lessons and tracks, and this teacher's warm-ups, games and
// videos — and the lesson's state, one document the panel saves every few
// seconds (architecture decision 9), with the teacher's note beside it.
import { and, eq, lt, sql } from "drizzle-orm";
import type { LessonPlan } from "../../domain/lesson-plan";
import {
  type BookLesson,
  initialState,
  type KeptState,
  type LessonBook,
  type LessonState,
  lessonStateSchema,
  type StageHomework,
  type StageVideo,
} from "../../domain/lesson-state";
import type { TextbookStructure } from "../../domain/textbook-structure";
import type { Database } from "../db/client";
import { lessonState, libraryMaterial } from "../db/schema";
import { findTextbook } from "../library/textbooks";
import { stageHomework, studentHomeworkIds } from "./homework";
import { stageVideos, textbookStageVideos } from "./video-review";
import { findPreparation, ownLesson, stageMaterials, studentWithTextbook } from "./prep";

/** The longest note: a lesson's worth of jottings. */
export const MAX_NOTE_LENGTH = 5000;

export type StageMaterial =
  | { id: string; kind: "warmup"; title: string; picture: string | null; questions: string[] }
  | { id: string; kind: "game" | "video"; title: string };

/** What a lesson can show, for the panel and the stage alike: nothing in it is the teacher's alone. */
export type LessonResources = {
  books: LessonBook[];
  lessons: BookLesson[];
  tracks: { name: string; url: string }[];
  materials: StageMaterial[];
  /** The submitted homework the plan's homework stages review (#153). The stage is the teacher's window: the keys are shown only when she says. */
  homework: StageHomework[];
  /** The student's textbook videos (#329), by file, for the labels of their stages. */
  videos: { id: string; title: string }[];
};

/** The student's textbook as the lesson shows it: the rendered books, the confirmed lessons and the tracks. */
async function textbookResources(db: Database, teacherId: string, studentId: string) {
  const found = await studentWithTextbook(db, teacherId, studentId);
  const book = found?.textbookId ? await findTextbook(db, teacherId, found.textbookId) : null;
  const structure: TextbookStructure | null = book ? found!.structure : null;
  return {
    textbookTitle: found?.textbookTitle ?? null,
    books: (book?.books ?? []).map((b) => ({ kind: b.kind, fileId: b.id, pageCount: b.pageCount })),
    lessons: (structure?.units ?? []).flatMap((u) => u.lessons.map((l) => ({ id: l.id!, title: l.title, pages: l.pages, tracks: l.tracks }))),
    tracks: (book?.tracks ?? []).map((t) => ({ name: t.name, url: `/api/files/textbooks/${t.id}` })),
    videos: (book?.videos ?? []).map((v) => ({ id: v.id, title: v.name })),
  };
}

/** This teacher's warm-ups, games and videos, with what a warm-up shows. */
async function materials(db: Database, teacherId: string): Promise<StageMaterial[]> {
  const listed = await stageMaterials(db, teacherId);
  if (listed.length === 0) return [];
  const warmups = await db
    .select({ id: libraryMaterial.id, hasFile: sql<boolean>`${libraryMaterial.blobId} is not null`, questions: libraryMaterial.questions })
    .from(libraryMaterial)
    .where(and(eq(libraryMaterial.teacherId, teacherId), eq(libraryMaterial.kind, "warmup")));
  const byId = new Map(warmups.map((w) => [w.id, w]));
  return listed.map((m) => {
    if (m.kind !== "warmup") return { id: m.id, kind: m.kind as "game" | "video", title: m.title };
    const w = byId.get(m.id);
    return { id: m.id, kind: "warmup", title: m.title, picture: w?.hasFile ? `/api/files/library/${m.id}` : null, questions: w?.questions ?? [] };
  });
}

/** A lesson of this teacher still to hold, and what it can show; null when there is no such lesson. */
export async function lessonResources(db: Database, teacherId: string, lessonId: string) {
  const prep = await findPreparation(db, teacherId, lessonId);
  if (!prep) return null;
  const book = await textbookResources(db, teacherId, prep.studentId);
  // The approved plan; without one, the plan the preparation proposes (product owner, 2026-11-19). Either way
  // with the waiting homework's review first, unless she saved the plan after it was submitted (#153).
  const plan: LessonPlan = prep.launch;
  // The kept state may hold a homework stage the plan no longer has: it is shown all the same.
  const [keptRow] = await db.select({ state: lessonState.state }).from(lessonState).where(eq(lessonState.lessonId, lessonId));
  const keptStages = lessonStateSchema.safeParse(keptRow?.state);
  const homeworkIds = [
    ...new Set([...plan.stages, ...(keptStages.success ? keptStages.data.stages : [])].flatMap((s) => (s.type === "homework" ? [s.homeworkId] : []))),
  ];
  const resources: LessonResources = {
    books: book.books,
    lessons: book.lessons,
    tracks: book.tracks,
    materials: await materials(db, teacherId),
    homework: await stageHomework(db, teacherId, prep.studentId, homeworkIds),
    videos: book.videos,
  };
  return {
    lessonId,
    studentId: prep.studentId,
    firstName: prep.firstName,
    startsAt: prep.startsAt,
    durationMinutes: prep.durationMinutes,
    textbookTitle: book.textbookTitle,
    plan,
    resources,
  };
}

/** The state kept on the server, or the one the plan starts with when none is kept yet. */
async function keptOrInitial(db: Database, lessonId: string, plan: LessonPlan, resources: LessonResources) {
  const [row] = await db
    .select({ revision: lessonState.revision, state: lessonState.state, note: lessonState.note })
    .from(lessonState)
    .where(eq(lessonState.lessonId, lessonId));
  const parsed = row ? lessonStateSchema.safeParse(row.state) : null;
  const kept: KeptState = parsed?.success
    ? { revision: row!.revision, state: parsed.data }
    : { revision: 0, state: initialState(plan, resources.lessons, resources.books, new Date()) };
  return { kept, note: row?.note ?? "" };
}

/**
 * The panel opens the lesson: what it can show, its state and the note. The
 * first opening keeps the state the plan starts with, so the stage and every
 * later opening start from the same one.
 */
export async function openLesson(db: Database, teacherId: string, lessonId: string) {
  const found = await lessonResources(db, teacherId, lessonId);
  if (!found) return null;
  const initial = initialState(found.plan, found.resources.lessons, found.resources.books, new Date());
  await db.insert(lessonState).values({ lessonId, teacherId, state: initial }).onConflictDoNothing({ target: lessonState.lessonId });
  const { kept, note } = await keptOrInitial(db, lessonId, found.plan, found.resources);
  return { ...found, kept, note };
}

/** The stage of a lesson: what it can show and its state. Never the note, the plan's minutes or the student's details. */
export async function lessonStage(db: Database, teacherId: string, lessonId: string) {
  const found = await lessonResources(db, teacherId, lessonId);
  if (!found) return null;
  const { kept } = await keptOrInitial(db, lessonId, found.plan, found.resources);
  return { lessonId, resources: found.resources, kept };
}

/**
 * The video stages' tasks with the student's answers from this lesson (#328),
 * asked again while the lesson goes on: the child answers under the video
 * after the panel has opened. Null when there is no such lesson.
 */
export async function lessonVideos(db: Database, teacherId: string, lessonId: string): Promise<StageVideo[] | null> {
  const prep = await findPreparation(db, teacherId, lessonId);
  if (!prep) return null;
  const [keptRow] = await db.select({ state: lessonState.state }).from(lessonState).where(eq(lessonState.lessonId, lessonId));
  const keptStages = lessonStateSchema.safeParse(keptRow?.state);
  const stages = [...prep.launch.stages, ...(keptStages.success ? keptStages.data.stages : [])];
  const ids = [...new Set(stages.flatMap((s) => (s.type === "material" ? [s.materialId] : [])))];
  // A state kept before #381 has no bank revision: the saved plan's is taken; none known, no bank tasks are shown.
  const planRevision = new Map((prep.plan?.stages ?? []).flatMap((s) => (s.type === "textbook_video" ? [[s.fileId, s.revision] as const] : [])));
  const textbookStages = stages.flatMap((s) =>
    s.type === "textbook_video" ? [{ ...s, revision: s.revision ?? planRevision.get(s.fileId) ?? "" }] : [],
  );
  return [
    ...(await stageVideos(db, teacherId, prep.studentId, lessonId, ids)),
    ...(await textbookStageVideos(db, teacherId, prep.studentId, lessonId, textbookStages)),
  ];
}

/** The homework a state's stages name that is not the student's own. */
async function foreignHomework(db: Database, teacherId: string, studentId: string, state: LessonState): Promise<string[]> {
  const ids = state.stages.flatMap((s) => (s.type === "homework" ? [s.homeworkId] : []));
  const own = await studentHomeworkIds(db, teacherId, studentId, ids);
  return state.stages.flatMap((s, i) => (s.type === "homework" && !own.has(s.homeworkId) ? [`этап ${i + 1}: такой домашки у ученика нет`] : []));
}

/** The state checked against what the lesson can show: the state, or the problems in words. */
function checkState(input: unknown, resources: LessonResources): { ok: true; state: LessonState } | { ok: false; errors: string[] } {
  const parsed = lessonStateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.slice(0, 10).map((i) => `${i.path.length > 0 ? `${i.path.join(".")}: ` : ""}${i.message}`) };
  }
  const lessons = new Set(resources.lessons.map((l) => l.id));
  const known = new Set(resources.materials.map((m) => m.id));
  const tracks = new Set(resources.tracks.map((t) => t.name));
  const videos = new Set(resources.videos.map((v) => v.id));
  const errors = parsed.data.stages.flatMap((s, i) =>
    s.type === "book" && !lessons.has(s.lessonId)
      ? [`этап ${i + 1}: такого урока нет в учебнике ученика`]
      : s.type === "material" && !known.has(s.materialId)
        ? [`этап ${i + 1}: такого материала нет в библиотеке`]
        : s.type === "textbook_video" && !videos.has(s.fileId)
          ? [`этап ${i + 1}: такого видео нет в учебнике ученика`]
          : [],
  );
  if (parsed.data.track && !tracks.has(parsed.data.track.name)) errors.push("такого трека нет в учебнике ученика");
  return errors.length > 0 ? { ok: false, errors } : { ok: true, state: parsed.data };
}

/**
 * Keeps the panel's state. `revision` is the panel's counter: the write
 * happens only when it is newer than the one kept, so a save that arrives
 * late never replaces a newer state. Returns "stale" then.
 */
export async function saveLessonState(
  db: Database,
  teacherId: string,
  lessonId: string,
  revision: number,
  input: unknown,
): Promise<"saved" | "stale" | "not_found" | { errors: string[] }> {
  const found = await lessonResources(db, teacherId, lessonId);
  if (!found) return "not_found";
  const checked = checkState(input, found.resources);
  if (!checked.ok) return { errors: checked.errors };
  const foreign = await foreignHomework(db, teacherId, found.studentId, checked.state);
  if (foreign.length > 0) return { errors: foreign };
  const rows = await db
    .insert(lessonState)
    .values({ lessonId, teacherId, state: checked.state, revision })
    .onConflictDoUpdate({
      target: lessonState.lessonId,
      set: { state: checked.state, revision, updatedAt: sql`now()` },
      setWhere: and(eq(lessonState.teacherId, teacherId), lt(lessonState.revision, revision)),
    })
    .returning({ lessonId: lessonState.lessonId });
  return rows.length > 0 ? "saved" : "stale";
}

/** Keeps the teacher's note to the lesson as she writes it. False when there is no such lesson of hers. */
export async function saveLessonNote(db: Database, teacherId: string, lessonId: string, note: string): Promise<boolean> {
  const found = await ownLesson(db, teacherId, lessonId);
  if (!found) return false;
  const [kept] = await db.select({ lessonId: lessonState.lessonId }).from(lessonState).where(eq(lessonState.lessonId, lessonId));
  if (!kept) await openLesson(db, teacherId, lessonId);
  const rows = await db
    .update(lessonState)
    .set({ note, updatedAt: sql`now()` })
    .where(and(eq(lessonState.lessonId, lessonId), eq(lessonState.teacherId, teacherId)))
    .returning({ lessonId: lessonState.lessonId });
  return rows.length > 0;
}
