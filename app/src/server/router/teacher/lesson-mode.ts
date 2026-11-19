import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { keptStateSchema } from "../../../domain/lesson-state";
import { BOOK_KINDS } from "../../../domain/textbook";
import { lessonStage, MAX_NOTE_LENGTH, openLesson, saveLessonNote, saveLessonState } from "../../lesson/mode";
import { router, teacherProcedure } from "../core/trpc";

const notFound = () => new TRPCError({ code: "NOT_FOUND" });
const range = z.object({ from: z.number().int(), to: z.number().int() }).strict();

// What a lesson can show: the student's textbook and this teacher's library. Nothing in it is the teacher's alone.
const resources = z
  .object({
    books: z.array(z.object({ kind: z.enum(BOOK_KINDS), fileId: z.uuid(), pageCount: z.number().int() }).strict()),
    lessons: z.array(
      z.object({ id: z.uuid(), title: z.string(), pages: z.partialRecord(z.enum(BOOK_KINDS), range), tracks: z.array(z.string()) }).strict(),
    ),
    tracks: z.array(z.object({ name: z.string(), url: z.string().startsWith("/api/files/textbooks/") }).strict()),
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

  /** Keeps the teacher's note to the lesson as she writes it. */
  saveNote: teacherProcedure
    .input(z.object({ lessonId: z.uuid(), note: z.string().max(MAX_NOTE_LENGTH) }))
    .output(z.object({ ok: z.literal(true) }).strict())
    .mutation(async ({ ctx, input }) => {
      if (!(await saveLessonNote(ctx.db, ctx.teacherId, input.lessonId, input.note))) throw notFound();
      return { ok: true as const };
    }),
});
