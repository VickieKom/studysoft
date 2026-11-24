import { gameWordsOutput } from "../../../domain/game-words-format";
import { lessonTemplateWords } from "../../library/game-words";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { gameResultSchema } from "../../../domain/game-result-format";
import { keptStateSchema, lessonWordSchema, MAX_LESSON_WORDS } from "../../../domain/lesson-state";
import { finishForm, finishLesson } from "../../lesson/finish";
import { saveStageGameResult } from "../../library/game-results";
import { BOOK_KINDS } from "../../../domain/textbook";
import { lessonVideos, lessonStage, MAX_NOTE_LENGTH, openLesson, saveLessonNote, saveLessonState } from "../../lesson/mode";
import { router, teacherProcedure } from "../core/trpc";

const notFound = () => new TRPCError({ code: "NOT_FOUND" });
const range = z.object({ from: z.number().int(), to: z.number().int() }).strict();

// What a lesson can show: the student's textbook and this teacher's library. Nothing in it is the teacher's alone.
/** A task under review on the stage, keys included: the stage shows one only when the teacher says (#153, #328). */
const stageTask = z
  .object({
    index: z.number().int(),
    prompt: z.string(),
    passage: z.string().nullable(),
    answer: z.string().nullable(),
    verdict: z.boolean().nullable(),
    key: z.string().nullable(),
    sentences: z.array(z.object({ answer: z.string().nullable(), key: z.string(), verdict: z.boolean() }).strict()).nullable(),
    file: z.object({ kind: z.enum(["audio", "image"]), url: z.string().startsWith("/api/files/answers/") }).strict().nullable(),
  })
  .strict();

const resources = z
  .object({
    books: z.array(z.object({ kind: z.enum(BOOK_KINDS), fileId: z.uuid(), pageCount: z.number().int() }).strict()),
    lessons: z.array(
      z.object({ id: z.uuid(), title: z.string(), pages: z.partialRecord(z.enum(BOOK_KINDS), range), tracks: z.array(z.string()) }).strict(),
    ),
    tracks: z.array(z.object({ name: z.string(), url: z.string().startsWith("/api/files/textbooks/") }).strict()),
    // The student's textbook videos (#329), for the labels of their stages.
    videos: z.array(z.object({ id: z.uuid(), title: z.string() }).strict()),
    materials: z.array(
      z.discriminatedUnion("kind", [
        z
          .object({
            id: z.uuid(),
            kind: z.literal("warmup"),
            title: z.string(),
            picture: z.string().startsWith("/api/files/library/").nullable(),
            questions: z.array(z.string()),
          })
          .strict(),
        z.object({ id: z.uuid(), kind: z.enum(["game", "video"]), title: z.string() }).strict(),
      ]),
    ),
    // The submitted homework its homework stages review (#153), keys included: the stage shows one only when the teacher says.
    homework: z.array(
      z
        .object({
          id: z.uuid(),
          title: z.string(),
          correct: z.number().int(),
          wrong: z.number().int(),
          pending: z.number().int(),
          tasks: z.array(stageTask),
        })
        .strict(),
    ),
  })
  .strict();

/** The lesson mode (#152): the panel and the stage of a lesson still to hold. */
export const lessonModeRouter = router({
  /** The panel opens the lesson: what it can show, its state and the note. */
  open: teacherProcedure
    .input(z.object({ lessonId: z.uuid() }))
    .output(
      z
        .object({
          lessonId: z.uuid(),
          firstName: z.string(),
          startsAt: z.iso.datetime(),
          durationMinutes: z.number().int(),
          textbookTitle: z.string().nullable(),
          resources,
          kept: keptStateSchema,
          note: z.string(),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const found = await openLesson(ctx.db, ctx.teacherId, input.lessonId);
      if (!found) throw notFound();
      return {
        lessonId: found.lessonId,
        firstName: found.firstName,
        startsAt: found.startsAt.toISOString(),
        durationMinutes: found.durationMinutes,
        textbookTitle: found.textbookTitle,
        resources: found.resources,
        kept: found.kept,
        note: found.note,
      };
    }),

  /** The stage: what the lesson can show and its state. Never the note. */
  stage: teacherProcedure
    .input(z.object({ lessonId: z.uuid() }))
    .output(z.object({ lessonId: z.uuid(), resources, kept: keptStateSchema }).strict())
    .query(async ({ ctx, input }) => {
      const found = await lessonStage(ctx.db, ctx.teacherId, input.lessonId);
      if (!found) throw notFound();
      return found;
    }),

  /**
   * The video stages' tasks with the student's answers from this lesson
   * (#328), asked again by the stage and the panel while a video stage is on.
   */
  videos: teacherProcedure
    .input(z.object({ lessonId: z.uuid() }))
    .output(z.array(z.object({ id: z.uuid(), title: z.string(), answered: z.boolean(), tasks: z.array(stageTask) }).strict()))
    .query(async ({ ctx, input }) => {
      const found = await lessonVideos(ctx.db, ctx.teacherId, input.lessonId);
      if (!found) throw notFound();
      return found;
    }),

  /** Keeps the panel's state; a save older than the kept one changes nothing. */
  saveState: teacherProcedure
    .input(z.object({ lessonId: z.uuid(), revision: z.number().int().min(1), state: z.unknown() }))
    .output(z.object({ saved: z.boolean() }).strict())
    .mutation(async ({ ctx, input }) => {
      const saved = await saveLessonState(ctx.db, ctx.teacherId, input.lessonId, input.revision, input.state);
      if (saved === "not_found") throw notFound();
      if (typeof saved === "object") throw new TRPCError({ code: "BAD_REQUEST", message: saved.errors.join("\n") });
      return { saved: saved === "saved" };
    }),

  /** What «Завершить урок» opens with (#154). */
  finishForm: teacherProcedure
    .input(z.object({ lessonId: z.uuid() }))
    .output(
      z
        .object({
          lessonId: z.uuid(),
          studentId: z.uuid(),
          lessons: z.array(z.object({ id: z.uuid(), label: z.string(), title: z.string() }).strict()),
          bookLessonId: z.uuid().nullable(),
          charged: z.boolean(),
          intro: z.boolean(),
          homework: z.object({ id: z.uuid(), title: z.string(), revision: z.string(), dueDate: z.iso.date() }).strict().nullable(),
          note: z.string(),
          words: z.array(lessonWordSchema),
        })
        .strict(),
    )
    .query(async ({ ctx, input }) => {
      const found = await finishForm(ctx.db, ctx.teacherId, input.lessonId);
      if (!found) throw notFound();
      return found;
    }),

  /** «Завершить урок»: every consequence in one transaction, or none (#154). */
  finish: teacherProcedure
    .input(
      z.object({
        lessonId: z.uuid(),
        charged: z.boolean(),
        note: z.string().max(MAX_NOTE_LENGTH),
        bookLessonId: z.uuid().nullable(),
        homework: z.object({ id: z.uuid(), revision: z.string().max(64), dueDate: z.iso.date() }).nullable(),
        words: z.array(lessonWordSchema).max(MAX_LESSON_WORDS),
      }),
    )
    .output(z.object({ studentId: z.uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      const { lessonId, ...form } = input;
      const result = await finishLesson(ctx.db, ctx.teacherId, lessonId, form);
      if (result === "not_found") throw notFound();
      if (result === "homework_changed") throw new TRPCError({ code: "CONFLICT", message: "Домашку к уроку изменили, пока форма была открыта. Откройте форму снова" });
      if (result === "past") throw new TRPCError({ code: "BAD_REQUEST", message: "Срок домашки уже прошёл" });
      if ("error" in result) throw new TRPCError({ code: "BAD_REQUEST", message: result.error });
      return result.finished;
    }),

  /** A result the game on the stage posted (#199): kept for the lesson's student, as a game played with the teacher. */
  saveGameResult: teacherProcedure
    .input(z.object({ lessonId: z.uuid(), materialId: z.uuid(), result: z.unknown() }))
    .output(z.object({ kept: z.literal(true) }).strict())
    .mutation(async ({ ctx, input }) => {
      const parsed = gameResultSchema.safeParse(input.result);
      if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: "Not a game result" });
      if (!(await saveStageGameResult(ctx.db, ctx.teacherId, input.lessonId, input.materialId, parsed.data.answers))) throw notFound();
      return { kept: true as const };
    }),

  /** The words of the lesson's student for a game template on the stage (#282); NOT_FOUND for anything else. */
  gameWords: teacherProcedure
    .input(z.object({ lessonId: z.uuid(), materialId: z.uuid() }))
    .output(gameWordsOutput)
    .query(async ({ ctx, input }) => {
      const words = await lessonTemplateWords(ctx.db, ctx.teacherId, input.lessonId, input.materialId);
      if (!words) throw notFound();
      return { words };
    }),

  /** Keeps the teacher's note to the lesson as she writes it. */
  saveNote: teacherProcedure
    .input(z.object({ lessonId: z.uuid(), note: z.string().max(MAX_NOTE_LENGTH) }))
    .output(z.object({ ok: z.literal(true) }).strict())
    .mutation(async ({ ctx, input }) => {
      if (!(await saveLessonNote(ctx.db, ctx.teacherId, input.lessonId, input.note))) throw notFound();
      return { ok: true as const };
    }),
});
