import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { BOOK_KINDS, RENDER_STATUSES } from "../../../domain/textbook";
import { DRAFT_AUTHORS, structureSchema } from "../../../domain/textbook-structure";
import { readBlob } from "../../blob/store";
import { readStructure, saveAssistantStructure } from "../../library/textbook-structure";
import { bookText, findTextbook, listTextbooks, MAX_TEXT_PAGES, textbookBlob } from "../../library/textbooks";
import { agentProcedure, router } from "../core/trpc";

// The assistant's textbook tools (#150): it reads a textbook's pages and
// saves a structure as a draft. There is no agent procedure that confirms a
// structure (AGENTS.md, rule 5): confirming is the teacher's.

const notFound = () => new TRPCError({ code: "NOT_FOUND" });

export const agentTextbooksRouter = router({
  /** The teacher's textbooks with their books (pages, once rendered) and tracks, and whether a structure is confirmed. */
  listTextbooks: agentProcedure
    .output(
      z.array(
        z
          .object({
            id: z.uuid(),
            title: z.string(),
            level: z.string(),
            books: z.array(
              z.object({ id: z.uuid(), kind: z.enum(BOOK_KINDS), status: z.enum(RENDER_STATUSES), pageCount: z.number().int() }).strict(),
            ),
            tracks: z.array(z.string()),
            confirmed: z.boolean(),
            draftBy: z.enum(DRAFT_AUTHORS).nullable(),
          })
          .strict(),
      ),
    )
    .query(async ({ ctx }) => {
      const list = await listTextbooks(ctx.db, ctx.teacherId);
      const result = [];
      for (const { id } of list) {
        const found = (await findTextbook(ctx.db, ctx.teacherId, id))!;
        const view = (await readStructure(ctx.db, ctx.teacherId, id))!;
        result.push({
          id,
          title: found.title,
          level: found.level,
          books: found.books.map(({ id: bookId, kind, status, pageCount }) => ({ id: bookId, kind, status, pageCount })),
          tracks: found.tracks.map((t) => t.name),
          confirmed: view.structure !== null,
          draftBy: view.draftBy,
        });
      }
      return result;
    }),

  /** The text layer of a book's pages, at most 20 at a time. */
  textbookText: agentProcedure
    .input(
      z
        .object({ bookId: z.uuid(), from: z.number().int().min(1), to: z.number().int().min(1) })
        .refine((r) => r.from <= r.to && r.to - r.from < MAX_TEXT_PAGES, { message: `from ≤ to, at most ${MAX_TEXT_PAGES} pages` }),
    )
    .output(z.array(z.object({ page: z.number().int(), text: z.string() }).strict()))
    .query(async ({ ctx, input }) => {
      const pages = await bookText(ctx.db, ctx.teacherId, input.bookId, input.from, input.to);
      if (!pages) throw notFound();
      return pages;
    }),

  /** One rendered page of a book as an image, for its pictures and layout. */
  textbookPage: agentProcedure
    .input(z.object({ bookId: z.uuid(), page: z.number().int().min(1) }))
    .output(z.object({ contentType: z.string(), base64: z.string() }).strict())
    .query(async ({ ctx, input }) => {
      const blobId = await textbookBlob(ctx.db, ctx.teacherId, input.bookId, input.page);
      const file = blobId ? await readBlob(ctx.db, ctx.teacherId, blobId) : null;
      if (!file) throw notFound();
      return { contentType: file.contentType, base64: Buffer.from(file.bytes).toString("base64") };
    }),

  /** The confirmed structure and the draft, to revise. */
  textbookStructure: agentProcedure
    .input(z.object({ textbookId: z.uuid() }))
    .output(z.object({ structure: structureSchema.nullable(), draft: structureSchema.nullable(), draftBy: z.enum(DRAFT_AUTHORS).nullable() }).strict())
    .query(async ({ ctx, input }) => {
      const view = await readStructure(ctx.db, ctx.teacherId, input.textbookId);
      if (!view) throw notFound();
      return { structure: view.structure, draft: view.draft, draftBy: view.draftBy };
    }),

  /**
   * Saves a structure as the assistant's draft, checked against the
   * textbook. The teacher corrects and confirms it. Refused while the
   * teacher has a draft of her own.
   */
  saveTextbookStructure: agentProcedure
    .input(z.object({ textbookId: z.uuid(), structure: z.unknown() }))
    .output(z.object({ status: z.literal("draft") }).strict())
    .mutation(async ({ ctx, input }) => {
      const saved = await saveAssistantStructure(ctx.db, ctx.teacherId, input.textbookId, input.structure);
      if (saved === "not_found") throw notFound();
      if (saved === "conflict") {
        throw new TRPCError({ code: "CONFLICT", message: "the teacher is editing a draft of her own; it can be replaced once she confirms" });
      }
      if (typeof saved === "object") throw new TRPCError({ code: "BAD_REQUEST", message: saved.errors.join("\n") });
      return { status: "draft" as const };
    }),
});
