import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { LEVELS } from "../../../domain/student";
import { BOOK_KINDS, MAX_TRACKS, RENDER_STATUSES } from "../../../domain/textbook";
import { DRAFT_AUTHORS, structureSchema } from "../../../domain/textbook-structure";
import { findLesson, readStructure, saveTeacherStructure } from "../../library/textbook-structure";
import { createTextbook, findTextbook, listTextbooks, retryRender } from "../../library/textbooks";
import { router, teacherProcedure } from "../core/trpc";

const notFound = () => new TRPCError({ code: "NOT_FOUND" });
const title = z.string().trim().min(1).max(200);
const fileName = z.string().trim().min(1).max(300);

/** Textbook sets in «Библиотека» (#156): the teacher's only. */
export const textbooksRouter = router({
  list: teacherProcedure
    .output(z.array(z.object({ id: z.uuid(), title: z.string(), level: z.string() }).strict()))
    .query(({ ctx }) => listTextbooks(ctx.db, ctx.teacherId)),

  get: teacherProcedure
    .input(z.object({ id: z.uuid() }))
    .output(
      z
        .object({
          id: z.uuid(),
          title: z.string(),
          level: z.string(),
          books: z.array(
            z
              .object({
                id: z.uuid(),
                kind: z.enum(BOOK_KINDS),
                name: z.string(),
                status: z.enum(RENDER_STATUSES),
                pageCount: z.number().int(),
              })
              .strict(),
          ),
          tracks: z.array(z.object({ id: z.uuid(), name: z.string() }).strict()),
        })
        .strict(),
    )
    .query(async ({ ctx, input }) => {
      const found = await findTextbook(ctx.db, ctx.teacherId, input.id);
      if (!found) throw notFound();
      return found;
    }),

  /** Saves a set whose files are uploaded; the books' pages are rendered after it. */
  create: teacherProcedure
    .input(
      z.object({
        title,
        level: z.enum(LEVELS),
        books: z.array(z.object({ kind: z.enum(BOOK_KINDS), name: fileName, file: z.uuid() })).max(BOOK_KINDS.length),
        tracks: z.array(z.object({ name: fileName, file: z.uuid() })).max(MAX_TRACKS),
      }),
    )
    .output(z.object({ id: z.uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      const created = await createTextbook(ctx.db, ctx.teacherId, input);
      if ("error" in created) throw new TRPCError({ code: "BAD_REQUEST", message: created.error });
      return created;
    }),

  /** Units and lessons (#150): the confirmed structure, and the draft with who wrote it. */
  structure: teacherProcedure
    .input(z.object({ id: z.uuid() }))
    .output(
      z
        .object({
          structure: structureSchema.nullable(),
          structureRevision: z.string(),
          draft: structureSchema.nullable(),
          draftBy: z.enum(DRAFT_AUTHORS).nullable(),
          revision: z.string(),
        })
        .strict(),
    )
    .query(async ({ ctx, input }) => {
      const view = await readStructure(ctx.db, ctx.teacherId, input.id);
      if (!view) throw notFound();
      return view;
    }),

  /**
   * Saves the teacher's edits of the structure as her draft, or with
   * `confirm` as the structure lessons use. `revision` is the draft's as her
   * form loaded it: a draft replaced meanwhile is a conflict.
   */
  saveStructure: teacherProcedure
    .input(z.object({ id: z.uuid(), structure: z.unknown(), revision: z.string().max(64), confirm: z.boolean() }))
    .output(z.object({ ok: z.literal(true) }).strict())
    .mutation(async ({ ctx, input }) => {
      const saved = await saveTeacherStructure(ctx.db, ctx.teacherId, input.id, input.structure, input.revision, input.confirm);
      if (saved === "not_found") throw notFound();
      if (saved === "conflict") {
        throw new TRPCError({ code: "CONFLICT", message: "Пока вы правили, пришёл новый черновик. Обновите страницу" });
      }
      if (typeof saved === "object") throw new TRPCError({ code: "BAD_REQUEST", message: saved.errors.join("\n") });
      return { ok: true as const };
    }),

  /** One lesson of the confirmed structure: its pages in each book, its tracks and words. */
  lesson: teacherProcedure
    .input(z.object({ textbookId: z.uuid(), lessonId: z.uuid() }))
    .output(
      z
        .object({
          textbookTitle: z.string(),
          unit: z.string(),
          title: z.string(),
          pages: z.array(z.object({ fileId: z.uuid(), kind: z.enum(BOOK_KINDS), from: z.number().int(), to: z.number().int() }).strict()),
          tracks: z.array(z.object({ id: z.uuid(), name: z.string() }).strict()),
          words: z.array(z.string()),
        })
        .strict(),
    )
    .query(async ({ ctx, input }) => {
      const found = await findLesson(ctx.db, ctx.teacherId, input.textbookId, input.lessonId);
      if (!found) throw notFound();
      return found;
    }),

  /** «Повторить»: renders a failed book again. */
  render: teacherProcedure
    .input(z.object({ fileId: z.uuid() }))
    .output(z.object({ ok: z.literal(true) }).strict())
    .mutation(async ({ ctx, input }) => {
      if (!(await retryRender(ctx.db, ctx.teacherId, input.fileId))) throw notFound();
      return { ok: true as const };
    }),
});
