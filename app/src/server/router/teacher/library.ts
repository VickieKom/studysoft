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
  MAX_URL_LENGTH,
} from "../../../domain/library";
import { LEVELS } from "../../../domain/student";
import {
  createGame,
  createPictureWarmup,
  createQuestionsWarmup,
  createVideoFile,
  createVideoLink,
  deleteMaterial,
  findMaterial,
  listMaterials,
  type Material,
  materialTopics,
  updateMaterial,
} from "../../library/library";
import { gameOpenedTo, openGameToStudent, studentsInLesson } from "../../library/student-games";
import { teacherTimeZone } from "../../access/settings";
import { router, teacherProcedure } from "../core/trpc";

const notFound = () => new TRPCError({ code: "NOT_FOUND" });

const tags = z.object({
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
  level: z.enum(LEVELS),
  topic: z
    .string()
    .trim()
    .max(MAX_TOPIC_LENGTH)
    .transform((t) => (t === "" ? null : t)),
  ageGroup: z.enum(AGE_GROUPS),
});

/** The lines of the questions field as sent; checked by `checkQuestions`, so the teacher reads a plain message. */
const questions = z.array(z.string().max(10 * MAX_QUESTION_LENGTH)).max(10 * MAX_QUESTIONS);

/** A questions warm-up's questions: each trimmed, empty lines dropped; 1 to 30, each at most 300 characters. */
function checkQuestions(lines: string[]): string[] {
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
const MAX_PICTURE_BASE64 = Math.ceil((2 * MAX_PICTURE_BYTES) / 3) * 4;

const material = z
  .object({
    id: z.uuid(),
    kind: z.enum(MATERIAL_KINDS),
    title: z.string(),
    level: z.enum(LEVELS),
    topic: z.string().nullable(),
    ageGroup: z.enum(AGE_GROUPS),
    /** A game's page, a warm-up's picture or an own video; null for a questions warm-up and a video link. */
    fileUrl: z.string().nullable(),
    questions: z.array(z.string()).nullable(),
    warmup: z.boolean(),
    // A video link's address; null for every other material.
    url: z.string().nullable(),
  })
  .strict();

const output = (m: Material) => ({
  id: m.id,
  kind: m.kind,
  title: m.title,
  level: m.level,
  topic: m.topic,
  ageGroup: m.ageGroup as AgeGroup,
  fileUrl: m.hasFile ? `/api/files/library/${m.id}` : null,
  questions: m.questions,
  warmup: m.warmup,
  url: m.url,
});

/** «Библиотека» (#115): the teacher's games, warm-ups (#116) and videos (#117). */
export const libraryRouter = router({
  list: teacherProcedure
    .input(
      z.object({
        kind: z.enum(MATERIAL_KINDS).optional(),
        level: z.enum(LEVELS).optional(),
        topic: z.string().max(MAX_TOPIC_LENGTH).optional(),
        ageGroup: z.enum(AGE_GROUPS).optional(),
      }),
    )
    .output(z.object({ materials: z.array(material), topics: z.array(z.string()), total: z.number().int() }).strict())
    .query(async ({ ctx, input }) => ({
      materials: (await listMaterials(ctx.db, ctx.teacherId, input)).map(output),
      topics: await materialTopics(ctx.db, ctx.teacherId),
      total: (await listMaterials(ctx.db, ctx.teacherId, {})).length,
    })),

  get: teacherProcedure
    .input(z.object({ id: z.uuid() }))
    .output(material)
    .query(async ({ ctx, input }) => {
      const found = await findMaterial(ctx.db, ctx.teacherId, input.id);
      if (!found) throw notFound();
      return output(found);
    }),

  /** A game: one HTML file as text, at most 5 MB. */
  addGame: teacherProcedure
    .input(tags.extend({ html: z.string().max(MAX_GAME_BYTES) }))
    .output(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { html, ...rest } = input;
      const created = await createGame(ctx.db, ctx.teacherId, rest, new TextEncoder().encode(html));
      if (created === "too_big") throw new TRPCError({ code: "BAD_REQUEST", message: "Файл больше 5 МБ" });
      if (created === "not_html")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Это не HTML-страница: нужна игра одним файлом .html" });
      return created;
    }),

  /** A video link: http or https (#117). Checked in the module, so the form shows the message. */
  addVideoLink: teacherProcedure
    .input(tags.extend({ url: z.string().trim().max(MAX_URL_LENGTH) }))
    .output(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { url, ...rest } = input;
      const created = await createVideoLink(ctx.db, ctx.teacherId, rest, url);
      if (created === "not_a_link")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Нужна ссылка, которая начинается с http:// или https://" });
      return created;
    }),

  /** An own video: its file is uploaded first with PUT to /api/files/library, which answers its id (#117). */
  addVideoFile: teacherProcedure
    .input(tags.extend({ file: z.uuid() }))
    .output(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { file, ...rest } = input;
      const created = await createVideoFile(ctx.db, ctx.teacherId, rest, file.toLowerCase());
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
   * «Открыть ученику» (#118): opens a game to a student while a lesson of
   * theirs is going on, until an hour after it ends. A missing or another
   * teacher's game is NOT_FOUND; a video, or a student without a lesson now
   * (another teacher's included), is refused with a message.
   */
  openToStudent: teacherProcedure
    .input(z.object({ id: z.uuid(), studentId: z.uuid() }))
    .output(z.object({ until: z.iso.datetime() }).strict())
    .mutation(async ({ ctx, input }) => {
      if (!(await findMaterial(ctx.db, ctx.teacherId, input.id))) throw notFound();
      const until = await openGameToStudent(ctx.db, ctx.teacherId, input.id, input.studentId.toLowerCase());
      if (!until) throw new TRPCError({ code: "BAD_REQUEST", message: "Открыть игру можно, пока идёт урок с этим учеником" });
      return { until: until.toISOString() };
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
    .input(tags.extend({ id: z.uuid(), warmup: z.boolean().optional(), questions: questions.optional() }))
    .output(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { id, questions: lines, ...rest } = input;
      const changes = { ...rest, ...(lines ? { questions: checkQuestions(lines) } : {}) };
      if (!(await updateMaterial(ctx.db, ctx.teacherId, id, changes))) throw notFound();
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
