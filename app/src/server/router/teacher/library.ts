import { MAX_MATERIAL_STUDENTS, materialStudents, ownStudents, setMaterialStudents } from "../../library/material-students";
import type { Database } from "../../db/client";
import { checkLink, type LinkableTextbook, linkableTextbooks, linkLabel } from "../../library/lesson-links";
import { gameWordsOutput } from "../../../domain/game-words-format";
import { templateWords } from "../../library/game-words";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  AGE_GROUPS,
  type AgeGroup,
  MATERIAL_KINDS,
  MAX_GAME_BYTES,
  MAX_PICTURE_BYTES,
  MAX_QUESTION_LENGTH,
  MAX_QUESTIONS,
  MAX_TITLE_LENGTH,
  MAX_TOPIC_LENGTH,
  MAX_TOPICS,
  parseTopics,
  MAX_TRANSCRIPT_LENGTH,
  MAX_URL_LENGTH,
} from "../../../domain/library";
import { studentTaskSchema } from "../../../domain/student-task-schema";
import { confirmVideoTasks, readVideoTasks, removeVideoDraftTask } from "../../library/video-tasks";
import { LEVELS } from "../../../domain/student";
import {
  addToLibrary,
  createGame,
  createPictureWarmup,
  createQuestionsWarmup,
  createVideoFile,
  createVideoLink,
  deleteMaterial,
  findMaterial,
  listDrafts,
  listMaterials,
  type LessonLink,
  type Material,
  materialTopics,
  updateMaterial,
} from "../../library/library";
import { gameResultSchema } from "../../../domain/game-result-format";
import { saveLessonGameResult } from "../../library/game-results";
import { gameOpenedTo, openGameToStudent, studentsInLesson } from "../../library/student-games";
import { teacherTimeZone } from "../../access/settings";
import { router, teacherProcedure } from "../core/trpc";

const notFound = () => new TRPCError({ code: "NOT_FOUND" });

/** A video's «Расшифровка» (#326): trimmed, empty for none; left out, an edit keeps it. */
const transcript = z
  .string()
  .max(MAX_TRANSCRIPT_LENGTH)
  .transform((text) => text.trim() || null)
  .optional();

/** A video's tasks as the child will see them, without keys; they carry no files (#326). */
const videoTask = studentTaskSchema("/api/files/video-tasks/");
const videoTasksChanged = () => new TRPCError({ code: "CONFLICT", message: "Задания изменились, пока страница была открыта. Обновите страницу" });

export const tags = z.object({
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
  level: z.enum(LEVELS),
  // Topics separated by commas (#290): at most 10, each at most 100 characters; empty for none.
  topic: z
    .string()
    .max(MAX_TOPICS * (MAX_TOPIC_LENGTH + 2))
    .transform(parseTopics)
    .refine((list) => list.length <= MAX_TOPICS, { message: `Не больше ${MAX_TOPICS} тем` })
    .refine((list) => list.every((t) => t.length <= MAX_TOPIC_LENGTH), { message: `Тема длиннее ${MAX_TOPIC_LENGTH} знаков` }),
  ageGroup: z.enum(AGE_GROUPS),
});

/** The lines of the questions field as sent; checked by `checkQuestions`, so the teacher reads a plain message. */
export const questions = z.array(z.string().max(10 * MAX_QUESTION_LENGTH)).max(10 * MAX_QUESTIONS);

/** A questions warm-up's questions: each trimmed, empty lines dropped; 1 to 30, each at most 300 characters. */
export function checkQuestions(lines: string[]): string[] {
  const list = lines.map((q) => q.trim()).filter((q) => q !== "");
  const refuse = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });
  if (list.length === 0) throw refuse("Нужен хотя бы один вопрос");
  if (list.length > MAX_QUESTIONS) throw refuse(`Не больше ${MAX_QUESTIONS} вопросов`);
  if (list.some((q) => q.length > MAX_QUESTION_LENGTH)) throw refuse(`Вопрос длиннее ${MAX_QUESTION_LENGTH} символов`);
  return list;
}

/**
 * The schema lets through twice the limit, so a picture a little over 2 MB
 * gets the size message from the check rather than a schema error.
 */
export const MAX_PICTURE_BASE64 = Math.ceil((2 * MAX_PICTURE_BYTES) / 3) * 4;

const material = z
  .object({
    id: z.uuid(),
    kind: z.enum(MATERIAL_KINDS),
    title: z.string(),
    level: z.enum(LEVELS),
    // Its topics (#290).
    topics: z.array(z.string()),
    ageGroup: z.enum(AGE_GROUPS),
    /** A game's page, a warm-up's picture or an own video; null for a questions warm-up and a video link. */
    fileUrl: z.string().nullable(),
    questions: z.array(z.string()).nullable(),
    warmup: z.boolean(),
    // A game template that gets a student's words (#282).
    vocabulary: z.boolean(),
    // A game's textbook lesson (#291); null when none, or the lesson is no longer in the structure.
    textbookLesson: z.object({ textbookId: z.uuid(), lessonId: z.uuid(), label: z.string() }).strict().nullable(),
    // The students a game is made for (#292), by name.
    students: z.array(z.object({ id: z.uuid(), name: z.string() }).strict()),
    // A video link's address; null for every other material.
    url: z.string().nullable(),
    /** Saved by the assistant and not yet in the library (#120). */
    draft: z.boolean(),
  })
  .strict();

const output = (books: LinkableTextbook[], marked: Map<string, { id: string; name: string }[]>) => (m: Material) => ({
  id: m.id,
  kind: m.kind,
  title: m.title,
  level: m.level,
  topics: m.topics,
  ageGroup: m.ageGroup as AgeGroup,
  fileUrl: m.hasFile ? `/api/files/library/${m.id}` : null,
  questions: m.questions,
  warmup: m.warmup,
  vocabulary: m.vocabulary,
  textbookLesson: lessonOf(books, m),
  students: marked.get(m.id) ?? [],
  url: m.url,
  draft: m.draft,
});

// A game's textbook lesson (#291): both ids, null for «Без учебника»; left out, an edit keeps the link.
export const linkInput = { textbookId: z.uuid().nullable().optional(), textbookLessonId: z.uuid().nullable().optional() };

/** The link as sent, checked: undefined when not sent, null when removed. A missing lesson is refused with a message. */
export async function checkedLink(
  ctx: { db: Database; teacherId: string },
  textbookId: string | null | undefined,
  lessonId: string | null | undefined,
): Promise<LessonLink | null | undefined> {
  if (textbookId === undefined && lessonId === undefined) return undefined;
  if (!textbookId) return null;
  if (!lessonId) throw new TRPCError({ code: "BAD_REQUEST", message: "Выберите урок учебника" });
  const checked = await checkLink(ctx.db, ctx.teacherId, textbookId.toLowerCase(), lessonId.toLowerCase());
  if (checked === "not_found") throw notFound();
  if (checked === "no_lesson") throw new TRPCError({ code: "BAD_REQUEST", message: "Такого урока нет в учебнике" });
  return { textbookId: textbookId.toLowerCase(), lessonId: lessonId.toLowerCase() };
}

// The students a game is made for (#292); left out, an edit keeps them.
export const studentIds = z.array(z.uuid()).max(MAX_MATERIAL_STUDENTS).optional();

/** The students as sent, all hers or NOT_FOUND; undefined when not sent. */
export async function checkedStudents(ctx: { db: Database; teacherId: string }, ids: string[] | undefined): Promise<string[] | undefined> {
  if (ids === undefined) return undefined;
  const lower = ids.map((id) => id.toLowerCase());
  if (!(await ownStudents(ctx.db, ctx.teacherId, lower))) throw notFound();
  return lower;
}

/** Materials as the procedures return them, with their links and students. */
async function outputs(ctx: { db: Database; teacherId: string }, materials: Material[]) {
  const books = await linkableTextbooks(ctx.db, ctx.teacherId);
  const marked = await materialStudents(ctx.db, ctx.teacherId, materials.map((m) => m.id));
  return materials.map(output(books, marked));
}

/** A material's link as its page names it, or null. */
function lessonOf(books: LinkableTextbook[], m: Material) {
  const label = linkLabel(books, m.textbookId, m.textbookLessonId);
  return label && m.textbookId && m.textbookLessonId ? { textbookId: m.textbookId, lessonId: m.textbookLessonId, label } : null;
}

/** «Библиотека» (#115): the teacher's games, warm-ups (#116) and videos (#117). */
export const libraryRouter = router({
  list: teacherProcedure
    .input(
      z.object({
        kind: z.enum(MATERIAL_KINDS).optional(),
        level: z.enum(LEVELS).optional(),
        topic: z.string().max(MAX_TOPIC_LENGTH).optional(),
        ageGroup: z.enum(AGE_GROUPS).optional(),
        // «Учебник» and «Урок» (#291).
        textbookId: z.uuid().optional(),
        lessonId: z.uuid().optional(),
        // «Ученик» (#292).
        studentId: z.uuid().optional(),
      }),
    )
    .output(z.object({ materials: z.array(material), topics: z.array(z.string()), total: z.number().int() }).strict())
    .query(async ({ ctx, input }) => ({
      materials: await outputs(ctx, await listMaterials(ctx.db, ctx.teacherId, input)),
      topics: await materialTopics(ctx.db, ctx.teacherId),
      total: (await listMaterials(ctx.db, ctx.teacherId, {})).length,
    })),

  /** «От ассистента» (#120): the assistant's drafts, not yet in the library. */
  drafts: teacherProcedure
    .output(z.array(material))
    .query(async ({ ctx }) => outputs(ctx, await listDrafts(ctx.db, ctx.teacherId))),

  /** Her textbooks with a confirmed structure and their lessons, for «Учебник» and «Урок» (#291). */
  textbooks: teacherProcedure
    .output(z.array(z.object({ id: z.uuid(), title: z.string(), lessons: z.array(z.object({ id: z.uuid(), label: z.string() }).strict()) }).strict()))
    .query(({ ctx }) => linkableTextbooks(ctx.db, ctx.teacherId)),

  /** «Добавить в библиотеку» on a draft's page (#120). Teacher only: no agent procedure adds a draft. */
  addToLibrary: teacherProcedure
    .input(z.object({ id: z.uuid() }))
    .output(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await addToLibrary(ctx.db, ctx.teacherId, input.id))) throw notFound();
      return { id: input.id };
    }),

  get: teacherProcedure
    .input(z.object({ id: z.uuid() }))
    // A video's transcript on its own page only, not in the lists (#326).
    .output(material.extend({ transcript: z.string().nullable() }).strict())
    .query(async ({ ctx, input }) => {
      const found = await findMaterial(ctx.db, ctx.teacherId, input.id);
      if (!found) throw notFound();
      return { ...(await outputs(ctx, [found]))[0]!, transcript: found.transcript };
    }),

  /**
   * «Задания к видео» on a video's page (#326): the confirmed tasks and the
   * assistant's draft beside them, as the child will see them, with the
   * draft's revision. Another teacher's video, and any other material, are
   * NOT_FOUND.
   */
  videoTasks: teacherProcedure
    .input(z.object({ id: z.uuid() }))
    .output(
      z
        .object({
          confirmed: z.array(videoTask).nullable(),
          draft: z.object({ tasks: z.array(videoTask), revision: z.string() }).strict().nullable(),
        })
        .strict(),
    )
    .query(async ({ ctx, input }) => {
      const tasks = await readVideoTasks(ctx.db, ctx.teacherId, input.id.toLowerCase());
      if (!tasks) throw notFound();
      return tasks;
    }),

  /** «Убрать»: one task out of the draft the page showed; the last one stays. */
  removeVideoTask: teacherProcedure
    .input(z.object({ id: z.uuid(), index: z.number().int().min(0), revision: z.string().max(64) }))
    .output(z.object({ ok: z.literal(true) }).strict())
    .mutation(async ({ ctx, input }) => {
      const result = await removeVideoDraftTask(ctx.db, ctx.teacherId, input.id.toLowerCase(), input.index, input.revision);
      if (result === "not_found") throw notFound();
      if (result === "conflict") throw videoTasksChanged();
      if (result === "last") throw new TRPCError({ code: "BAD_REQUEST", message: "Последнее задание убрать нельзя" });
      return { ok: true as const };
    }),

  /** «Подтвердить»: the draft the page showed becomes the video's tasks. Teacher only: no agent procedure confirms. */
  confirmVideoTasks: teacherProcedure
    .input(z.object({ id: z.uuid(), revision: z.string().max(64) }))
    .output(z.object({ ok: z.literal(true) }).strict())
    .mutation(async ({ ctx, input }) => {
      const result = await confirmVideoTasks(ctx.db, ctx.teacherId, input.id.toLowerCase(), input.revision);
      if (result === "not_found") throw notFound();
      if (result !== "saved") throw videoTasksChanged();
      return { ok: true as const };
    }),

  /** A game: one HTML file as text, at most 5 MB. */
  addGame: teacherProcedure
    .input(tags.extend({ html: z.string().max(MAX_GAME_BYTES), vocabulary: z.boolean().default(false), ...linkInput, studentIds }))
    .output(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { html, vocabulary, textbookId, textbookLessonId, studentIds: marked, ...rest } = input;
      const link = (await checkedLink(ctx, textbookId, textbookLessonId)) ?? null;
      const forStudents = await checkedStudents(ctx, marked);
      const created = await createGame(ctx.db, ctx.teacherId, rest, new TextEncoder().encode(html), vocabulary, link);
      if (typeof created === "object" && forStudents) await setMaterialStudents(ctx.db, ctx.teacherId, created.id, forStudents);
      if (created === "too_big") throw new TRPCError({ code: "BAD_REQUEST", message: "Файл больше 5 МБ" });
      if (created === "not_html")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Это не HTML-страница: нужна игра одним файлом .html" });
      return created;
    }),

  /** A video link: http or https (#117). Checked in the module, so the form shows the message. */
  addVideoLink: teacherProcedure
    .input(tags.extend({ url: z.string().trim().max(MAX_URL_LENGTH), transcript }))
    .output(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { url, transcript: text, ...rest } = input;
      const created = await createVideoLink(ctx.db, ctx.teacherId, rest, url, text ?? null);
      if (created === "not_a_link")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Нужна ссылка, которая начинается с http:// или https://" });
      return created;
    }),

  /** An own video: its file is uploaded first with PUT to /api/files/library, which answers its id (#117). */
  addVideoFile: teacherProcedure
    .input(tags.extend({ file: z.uuid(), transcript }))
    .output(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { file, transcript: text, ...rest } = input;
      const created = await createVideoFile(ctx.db, ctx.teacherId, rest, file.toLowerCase(), text ?? null);
      if (created === "no_file") throw new TRPCError({ code: "BAD_REQUEST", message: "Не нашли загруженное видео. Загрузите файл ещё раз" });
      return created;
    }),

  /** Students with a lesson going on now: the ones a game can be opened to (#118). */
  studentsInLesson: teacherProcedure
    .output(z.array(z.object({ studentId: z.uuid(), name: z.string() }).strict()))
    .query(({ ctx }) => studentsInLesson(ctx.db, ctx.teacherId)),

  /** Whom a game is open to now, until when, and the teacher's time zone to show it in (#118). */
  openedTo: teacherProcedure
    .input(z.object({ id: z.uuid() }))
    .output(
      z
        .object({
          timeZone: z.string(),
          students: z.array(z.object({ studentId: z.uuid(), name: z.string(), until: z.iso.datetime() }).strict()),
        })
        .strict(),
    )
    .query(async ({ ctx, input }) => {
      if (!(await findMaterial(ctx.db, ctx.teacherId, input.id))) throw notFound();
      return {
        timeZone: await teacherTimeZone(ctx.db, ctx.teacherId),
        students: (await gameOpenedTo(ctx.db, ctx.teacherId, input.id)).map((s) => ({ ...s, until: s.until.toISOString() })),
      };
    }),

  /**
   * «Открыть ученику» (#118, #158): opens a game or a video to a student while
   * a lesson of theirs is going on, until an hour after it ends. A missing or
   * another teacher's material is NOT_FOUND; a warm-up, or a student without a
   * lesson now (another teacher's included), is refused with a message.
   */
  openToStudent: teacherProcedure
    .input(z.object({ id: z.uuid(), studentId: z.uuid() }))
    .output(z.object({ until: z.iso.datetime() }).strict())
    .mutation(async ({ ctx, input }) => {
      if (!(await findMaterial(ctx.db, ctx.teacherId, input.id))) throw notFound();
      const until = await openGameToStudent(ctx.db, ctx.teacherId, input.id, input.studentId.toLowerCase());
      if (!until) throw new TRPCError({ code: "BAD_REQUEST", message: "Открыть ученику можно, пока идёт урок с этим учеником" });
      return { until: until.toISOString() };
    }),

  /**
   * The words a game template gets on her page (#282): of the student she
   * picks, or of the lesson's. A game not marked «Со словами словаря», or
   * not hers, or another teacher's student: NOT_FOUND.
   */
  words: teacherProcedure
    .input(z.object({ id: z.uuid(), studentId: z.uuid() }))
    .output(gameWordsOutput)
    .query(async ({ ctx, input }) => {
      const words = await templateWords(ctx.db, ctx.teacherId, input.id, input.studentId.toLowerCase());
      if (!words) throw notFound();
      return { words };
    }),

  /**
   * A result of a game the teacher runs on her page during a lesson (#147),
   * kept for the student of that lesson. A missing or another teacher's game
   * is NOT_FOUND; a message not in the game result format, or a student
   * without a lesson now (another teacher's included), is BAD_REQUEST.
   */
  saveLessonResult: teacherProcedure
    .input(z.object({ id: z.uuid(), studentId: z.uuid(), result: z.unknown() }))
    .output(z.object({ kept: z.literal(true) }).strict())
    .mutation(async ({ ctx, input }) => {
      if (!(await findMaterial(ctx.db, ctx.teacherId, input.id))) throw notFound();
      const parsed = gameResultSchema.safeParse(input.result);
      if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: "Not a game result" });
      const kept = await saveLessonGameResult(ctx.db, ctx.teacherId, input.id, input.studentId.toLowerCase(), parsed.data.answers);
      if (!kept) throw new TRPCError({ code: "BAD_REQUEST", message: "Итог игры сохраняется, пока идёт урок с этим учеником" });
      return { kept: true as const };
    }),

  /** A warm-up: a picture (base64, PNG, JPEG or WebP, at most 2 MB) or a list of questions (#116). */
  addWarmup: teacherProcedure
    .input(
      z.discriminatedUnion("format", [
        tags.extend({ format: z.literal("picture"), picture: z.base64().max(MAX_PICTURE_BASE64) }),
        tags.extend({ format: z.literal("questions"), questions }),
      ]),
    )
    .output(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (input.format === "questions") {
        const { format: _f, questions: list, ...rest } = input;
        return createQuestionsWarmup(ctx.db, ctx.teacherId, rest, checkQuestions(list));
      }
      const { format: _f, picture, ...rest } = input;
      const created = await createPictureWarmup(ctx.db, ctx.teacherId, rest, Buffer.from(picture, "base64"));
      if (created === "too_big") throw new TRPCError({ code: "BAD_REQUEST", message: "Картинка больше 2 МБ" });
      if (created === "not_picture")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Нужна картинка PNG, JPEG или WebP" });
      return created;
    }),

  /** Title and tags; a game's warm-up mark; a questions warm-up's questions. */
  update: teacherProcedure
    .input(
      tags.extend({ id: z.uuid(), warmup: z.boolean().optional(), vocabulary: z.boolean().optional(), questions: questions.optional(), transcript, ...linkInput, studentIds }),
    )
    .output(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { id, questions: lines, textbookId, textbookLessonId, studentIds: marked, ...rest } = input;
      const link = await checkedLink(ctx, textbookId, textbookLessonId);
      const forStudents = await checkedStudents(ctx, marked);
      const changes = { ...rest, ...(lines ? { questions: checkQuestions(lines) } : {}), ...(link !== undefined ? { link } : {}) };
      if (!(await updateMaterial(ctx.db, ctx.teacherId, id, changes))) throw notFound();
      // The mark is a game's only (#292).
      if (forStudents && (await findMaterial(ctx.db, ctx.teacherId, id))?.kind === "game") await setMaterialStudents(ctx.db, ctx.teacherId, id, forStudents);
      return { id };
    }),

  remove: teacherProcedure
    .input(z.object({ id: z.uuid() }))
    .output(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await deleteMaterial(ctx.db, ctx.teacherId, input.id))) throw notFound();
      return { id: input.id };
    }),
});
