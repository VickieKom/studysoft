// The lesson mode's state (#152, architecture decision 9): one document of
// what is on the stage. The panel changes it and sends it to the stage over
// BroadcastChannel; it is kept in the browser and on the server, so a stage
// closed mid-lesson opens where it was. The teacher's note is not part of
// it: the stage never receives it. Plain data, zod and pure functions only.
import { z } from "zod";
import { MAX_STAGE_MINUTES, MAX_STAGES, type LessonPlan } from "./lesson-plan";
import { BOOK_KINDS, BOOK_LABELS, type BookKind } from "./textbook";

/** Stages added during a lesson come on top of a full plan. */
export const MAX_LESSON_STAGES = MAX_STAGES + 10;
/** How often the panel saves the state to the server, in milliseconds: «every few seconds». */
export const STATE_SAVE_MS = 2000;

const page = z.number().int().min(1).max(10_000);
/** «Все задания» or «Только ошибки» on a homework stage (#153); it opens on all of them (product owner, 2026-11-19). */
export const HOMEWORK_FILTERS = ["all", "wrong"] as const;
/** A homework has far fewer tasks than this; the bound only keeps the document small. */
const MAX_TASK_INDEX = 199;

/** The most words a lesson collects on the panel, and how long a word and its translation may be. */
export const MAX_LESSON_WORDS = 200;
export const MAX_WORD_LENGTH = 100;
export const MAX_TRANSLATION_LENGTH = 200;

/** A word the teacher noted on the panel during the lesson (#154): the word, and its translation or "". */
export const lessonWordSchema = z
  .object({ word: z.string().trim().min(1).max(MAX_WORD_LENGTH), translation: z.string().trim().max(MAX_TRANSLATION_LENGTH) })
  .strict();
export type LessonWord = z.infer<typeof lessonWordSchema>;
const minutes = z.number().int().min(0).max(MAX_STAGE_MINUTES);

const stage = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("book"),
      lessonId: z.uuid(),
      skip: z.string().trim().max(200),
      minutes,
      done: z.boolean(),
      // The book on the stage, and the page each book was left at.
      kind: z.enum(BOOK_KINDS),
      pages: z.partialRecord(z.enum(BOOK_KINDS), page),
    })
    .strict(),
  z.object({ type: z.literal("material"), materialId: z.uuid(), minutes, done: z.boolean() }).strict(),
  // The homework under review (#153): which tasks the stage shows, and the tasks whose right answer the teacher has shown.
  z
    .object({
      type: z.literal("homework"),
      homeworkId: z.uuid(),
      minutes,
      done: z.boolean(),
      filter: z.enum(HOMEWORK_FILTERS),
      shown: z.array(z.number().int().min(0).max(MAX_TASK_INDEX)).max(MAX_TASK_INDEX + 1),
    })
    .strict(),
]);

export const lessonStateSchema = z
  .object({
    stages: z.array(stage).max(MAX_LESSON_STAGES),
    current: z.number().int().min(0),
    layout: z.enum(["single", "spread"]),
    // The track on the stage; `run` changes with every «Играть», so the same track can start again.
    track: z.object({ name: z.string().min(1).max(200), playing: z.boolean(), run: z.number().int().min(0) }).strict().nullable(),
    startedAt: z.iso.datetime(),
    // «Слова урока» (#154); a state kept before them has none.
    words: z.array(lessonWordSchema).max(MAX_LESSON_WORDS).default([]),
  })
  .strict()
  .refine((s) => s.stages.length === 0 || s.current < s.stages.length, { path: ["current"], message: "нет такого этапа" });

export type LessonState = z.infer<typeof lessonStateSchema>;
export type StateStage = z.infer<typeof stage>;
export type BookStage = Extract<StateStage, { type: "book" }>;
export type HomeworkStage = Extract<StateStage, { type: "homework" }>;

/** A book of the student's set as the lesson mode needs it. */
export type LessonBook = { kind: BookKind; fileId: string; pageCount: number };
/** A lesson of the textbook: its page range in each book and its tracks. */
export type BookLesson = { id: string; title: string; pages: Partial<Record<BookKind, { from: number; to: number }>>; tracks: string[] };

/** The book a lesson stage opens in: the Student's Book when the lesson has pages in it, else the first book it has pages in. */
export function firstBook(lesson: BookLesson | undefined, books: LessonBook[]): BookKind {
  const ready = books.filter((b) => b.pageCount > 0).map((b) => b.kind);
  return BOOK_KINDS.find((k) => ready.includes(k) && lesson?.pages[k]) ?? ready[0] ?? "students_book";
}

/** The lesson's first page in a book, or page 1 when the lesson has none there. */
export function lessonPage(lesson: BookLesson | undefined, kind: BookKind): number {
  return lesson?.pages[kind]?.from ?? 1;
}

/** The page a book stage shows in a book: where it was left, else the lesson's first page there. */
export function pageIn(stage: BookStage, lesson: BookLesson | undefined, kind: BookKind): number {
  return stage.pages[kind] ?? lessonPage(lesson, kind);
}

/** The pages on the stage: one, or the spread holding it — an even page on the left, the odd one on the right; page 1 alone. */
export function shownPages(at: number, layout: LessonState["layout"], pageCount: number): number[] {
  if (layout === "single" || at === 1) return [at];
  const left = at % 2 === 0 ? at : at - 1;
  return left + 1 <= pageCount ? [left, left + 1] : [left];
}

/** The page after turning forward or back: by a page, or by a spread; never past the book's ends. */
export function turnPage(at: number, by: 1 | -1, layout: LessonState["layout"], pageCount: number): number {
  const shown = shownPages(at, layout, pageCount);
  const next = by === 1 ? shown.at(-1)! + 1 : shown[0]! - 1;
  return Math.min(Math.max(next, 1), Math.max(pageCount, 1));
}

/** The state a lesson starts with: the plan's stages, the first one current, each book stage at its lesson's first page. */
export function initialState(plan: LessonPlan, lessons: BookLesson[], books: LessonBook[], now: Date): LessonState {
  return {
    stages: plan.stages.map((s) =>
      s.type === "book"
        ? bookStage(s.lessonId, s.minutes, s.skip, lessons, books)
        : s.type === "homework"
          ? { ...s, done: false, filter: "all" as const, shown: [] }
          : { ...s, done: false },
    ),
    current: 0,
    layout: "single",
    track: null,
    startedAt: now.toISOString(),
    words: [],
  };
}

/** A new book stage at its lesson's first page. */
export function bookStage(lessonId: string, minutes: number, skip: string, lessons: BookLesson[], books: LessonBook[]): BookStage {
  const lesson = lessons.find((l) => l.id === lessonId);
  const kind = firstBook(lesson, books);
  return { type: "book", lessonId, skip, minutes, done: false, kind, pages: { [kind]: lessonPage(lesson, kind) } };
}

/** Makes a stage current; the one left is ticked. */
export function goToStage(state: LessonState, index: number): LessonState {
  if (index === state.current || index < 0 || index >= state.stages.length) return state;
  return { ...state, current: index, stages: state.stages.map((s, i) => (i === state.current ? { ...s, done: true } : s)) };
}

/** Removes a stage; the current one stays current, or the one after it when it is the one removed. */
export function removeStage(state: LessonState, index: number): LessonState {
  if (index < 0 || index >= state.stages.length) return state;
  const stages = state.stages.filter((_, i) => i !== index);
  const current = index < state.current ? state.current - 1 : Math.min(state.current, Math.max(stages.length - 1, 0));
  return { ...state, stages, current };
}

/** What tells stages apart in a list: the lesson, the material or the homework they show. */
export function stageKey(stage: StateStage): string {
  return stage.type === "book" ? stage.lessonId : stage.type === "material" ? stage.materialId : stage.homeworkId;
}

/** The label of a book stage, as the plan shows it. */
export function bookStageLabel(lesson: BookLesson | undefined): string {
  return `Student's Book: ${lesson?.title ?? "урок не найден"}`;
}

/** «Student's Book, стр. 4»: how a page is named on the stage and the panel. */
export function pageLabel(kind: BookKind, at: number): string {
  return `${BOOK_LABELS[kind]}, стр. ${at}`;
}

/** The channel the panel and the stage of one lesson talk over. */
export function lessonChannel(lessonId: string): string {
  return `studysoft-lesson-${lessonId}`;
}

/** Where a browser keeps the state of a lesson. */
export function lessonStorageKey(lessonId: string): string {
  return `studysoft-lesson-${lessonId}`;
}

/** A state kept with the panel's counter: the larger counter is the newer state. */
export const keptStateSchema = z.object({ revision: z.number().int().min(0), state: lessonStateSchema }).strict();
export type KeptState = z.infer<typeof keptStateSchema>;

/** The newer of two kept states; the first when they are equal. */
export function newer(a: KeptState | null, b: KeptState | null): KeptState | null {
  if (!a) return b;
  if (!b) return a;
  return b.revision > a.revision ? b : a;
}

/** What the panel and the stage send each other. The note is never among them. */
export const lessonMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("state"), kept: keptStateSchema }).strict(),
  // The stage asks for the state when it opens, and says it is there every few seconds.
  z.object({ type: z.literal("hello") }).strict(),
  z.object({ type: z.literal("sound"), status: z.enum(["blocked", "on"]) }).strict(),
  // «Завершить урок» went through: the stage says the lesson is over (#154).
  z.object({ type: z.literal("finished") }).strict(),
]);
export type LessonMessage = z.infer<typeof lessonMessageSchema>;

/** A task of the homework under review, as the stage shows it: the answer, the verdict, and the key it shows only when the teacher says. */
export type StageHomeworkTask = {
  index: number;
  prompt: string;
  passage: string | null;
  answer: string | null;
  /** The teacher's mark if any, else the platform's result; null while it waits for her. */
  verdict: boolean | null;
  key: string | null;
  sentences: { answer: string | null; key: string; verdict: boolean }[] | null;
  file: { kind: "audio" | "image"; url: string } | null;
};

/** The submitted homework a homework stage reviews (#153). */
export type StageHomework = { id: string; title: string; correct: number; wrong: number; pending: number; tasks: StageHomeworkTask[] };

/** A task with a mistake: wrong, or a sentence of it wrong. */
export function isMistake(task: StageHomeworkTask): boolean {
  return task.verdict === false || (task.sentences?.some((s) => !s.verdict) ?? false);
}

/** The tasks a homework stage shows under its filter. */
export function visibleTasks(stage: HomeworkStage, homework: StageHomework): StageHomeworkTask[] {
  return stage.filter === "wrong" ? homework.tasks.filter(isMistake) : homework.tasks;
}

/** Shows or hides a task's right answer on the stage. */
export function toggleShown(stage: HomeworkStage, index: number): HomeworkStage {
  return { ...stage, shown: stage.shown.includes(index) ? stage.shown.filter((i) => i !== index) : [...stage.shown, index].sort((a, b) => a - b) };
}

/** The label of a homework stage: «Домашка: …». */
export function homeworkStageLabel(homework: StageHomework | undefined): string {
  return homework ? `Домашка: ${homework.title}` : "Домашка";
}

/** Adds a word to «Слова урока»; one already there (regardless of case) gets the new translation if it had none. */
export function addWord(words: LessonWord[], added: LessonWord): LessonWord[] {
  const word = added.word.trim();
  const translation = added.translation.trim();
  if (!word) return words;
  const at = words.findIndex((w) => w.word.toLowerCase() === word.toLowerCase());
  if (at === -1) return words.length >= MAX_LESSON_WORDS ? words : [...words, { word, translation }];
  return words.map((w, i) => (i === at && !w.translation && translation ? { ...w, translation } : w));
}
