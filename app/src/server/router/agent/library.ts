import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { MAX_GAME_BYTES } from "../../../domain/library";
import { saveDraft, storeGame, storePicture } from "../../library/library";
import { agentProcedure, router } from "../core/trpc";
import { checkQuestions, MAX_PICTURE_BASE64, questions, tags } from "../teacher/library";

// The assistant's library tools (#120): it saves games and warm-ups as
// drafts with the same checks as an upload. Drafts only: there is no agent
// procedure that adds a draft to the library or deletes anything (AGENTS.md,
// rule 5). Given the id of its earlier draft, it replaces that draft while
// the teacher has neither edited nor added it; otherwise a new draft is made.

const refuse = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });
const replace = z.uuid().optional();
const saved = z.object({ id: z.uuid() }).strict();

export const agentLibraryRouter = router({
  /** A game: one HTML file as text, at most 5 MB. */
  saveGameDraft: agentProcedure
    .input(tags.extend({ id: replace, html: z.string().max(MAX_GAME_BYTES) }))
    .output(saved)
    .mutation(async ({ ctx, input }) => {
      const { id, html, ...rest } = input;
      const blobId = await storeGame(ctx.db, ctx.teacherId, new TextEncoder().encode(html));
      if (blobId === "too_big") throw refuse("Файл больше 5 МБ");
      if (blobId === "not_html") throw refuse("Это не HTML-страница: нужна игра одним файлом .html");
      return { id: await saveDraft(ctx.db, ctx.teacherId, rest, { kind: "game", blobId }, id?.toLowerCase()) };
    }),

  /** A warm-up: a picture (base64, PNG, JPEG or WebP, at most 2 MB) or a list of questions. */
  saveWarmupDraft: agentProcedure
    .input(
      z.discriminatedUnion("format", [
        tags.extend({ id: replace, format: z.literal("picture"), picture: z.base64().max(MAX_PICTURE_BASE64) }),
        tags.extend({ id: replace, format: z.literal("questions"), questions }),
      ]),
    )
    .output(saved)
    .mutation(async ({ ctx, input }) => {
      if (input.format === "questions") {
        const { id, format: _f, questions: lines, ...rest } = input;
        const content = { kind: "warmup" as const, questions: checkQuestions(lines) };
        return { id: await saveDraft(ctx.db, ctx.teacherId, rest, content, id?.toLowerCase()) };
      }
      const { id, format: _f, picture, ...rest } = input;
      const blobId = await storePicture(ctx.db, ctx.teacherId, Buffer.from(picture, "base64"));
      if (blobId === "too_big") throw refuse("Картинка больше 2 МБ");
      if (blobId === "not_picture") throw refuse("Нужна картинка PNG, JPEG или WebP");
      return { id: await saveDraft(ctx.db, ctx.teacherId, rest, { kind: "warmup", blobId }, id?.toLowerCase()) };
    }),
});
