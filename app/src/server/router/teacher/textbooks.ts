import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { LEVELS } from "../../../domain/student";
import { BOOK_KINDS, MAX_TRACKS, RENDER_STATUSES } from "../../../domain/textbook";
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

  /** «Повторить»: renders a failed book again. */
  render: teacherProcedure
    .input(z.object({ fileId: z.uuid() }))
    .output(z.object({ ok: z.literal(true) }).strict())
    .mutation(async ({ ctx, input }) => {
      if (!(await retryRender(ctx.db, ctx.teacherId, input.fileId))) throw notFound();
      return { ok: true as const };
    }),
});
