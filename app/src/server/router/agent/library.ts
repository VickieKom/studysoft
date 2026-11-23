import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { MAX_GAME_BYTES } from "../../../domain/library";
import { saveDraft, storeGame, storePicture } from "../../library/library";
import { libraryVideo, saveAssistantVideoTasks } from "../../library/video-tasks";
import { agentProcedure, router } from "../core/trpc";
import { checkedLink, checkedStudents, checkQuestions, linkInput, MAX_PICTURE_BASE64, questions, studentIds, tags } from "../teacher/library";
import { setMaterialStudents } from "../../library/material-students";

// The assistant's library tools (#120): it saves games and warm-ups as
// drafts with the same checks as an upload. Drafts only: there is no agent
// procedure that adds a draft to the library or deletes anything (AGENTS.md,
// rule 5). Given the id of its earlier draft, it replaces that draft while
// the teacher has neither edited nor added it; otherwise a new draft is made.

const refuse = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });
const replace = z.uuid().optional();
const saved = z.object({ id: z.uuid() }).strict();
const notFound = () => new TRPCError({ code: "NOT_FOUND" });
/** A video's tasks as JSON, at most this long: text only, a few minutes of video. */
const MAX_VIDEO_TASKS_LENGTH = 200_000;

export const agentLibraryRouter = router({
  /** A game: one HTML file as text, at most 5 MB; `vocabulary` marks a game template that gets a student's words (#282). */
  saveGameDraft: agentProcedure
    .input(tags.extend({ id: replace, html: z.string().max(MAX_GAME_BYTES), vocabulary: z.boolean().default(false), ...linkInput, studentIds }))
    .output(saved)
    .mutation(async ({ ctx, input }) => {
      const { id, html, vocabulary, textbookId, textbookLessonId, studentIds: marked, ...rest } = input;
      // A textbook lesson (#291), checked like the teacher's: a lesson not in the confirmed structure is refused.
      const link = (await checkedLink(ctx, textbookId, textbookLessonId)) ?? null;
      // The students it is made for (#292): hers only.
      const forStudents = await checkedStudents(ctx, marked);
      const blobId = await storeGame(ctx.db, ctx.teacherId, new TextEncoder().encode(html));
      if (blobId === "too_big") throw refuse("Файл больше 5 МБ");
      if (blobId === "not_html") throw refuse("Это не HTML-страница: нужна игра одним файлом .html");
      const saved = await saveDraft(ctx.db, ctx.teacherId, rest, { kind: "game", blobId, vocabulary, link }, id?.toLowerCase());
      if (forStudents) await setMaterialStudents(ctx.db, ctx.teacherId, saved, forStudents);
      return { id: saved };
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
  /**
   * A video of the teacher's library with its link and the transcript she
   * typed in «Расшифровка» (#326), to draft its tasks from. Another
   * teacher's video, and any other material, are NOT_FOUND.
   */
  libraryVideo: agentProcedure
    .input(z.object({ id: z.uuid() }))
    .output(z.object({ id: z.uuid(), title: z.string(), link: z.string().nullable(), transcript: z.string().nullable() }).strict())
    .query(async ({ ctx, input }) => {
      const video = await libraryVideo(ctx.db, ctx.teacherId, input.id.toLowerCase());
      if (!video) throw notFound();
      return video;
    }),

  /**
   * A library video's tasks in the homework format { version, title, tasks },
   * checked like an import, saved as the assistant's draft beside the
   * confirmed tasks (#326). It replaces the draft while the teacher has done
   * nothing to it; once she has removed a task, the save is refused so that
   * her edit stays. Confirming is the teacher's only.
   */
  saveVideoTasksDraft: agentProcedure
    .input(
      z.object({
        videoId: z.uuid(),
        tasks: z.unknown().refine((value) => (JSON.stringify(value) ?? "").length <= MAX_VIDEO_TASKS_LENGTH, {
          message: `The tasks are longer than ${MAX_VIDEO_TASKS_LENGTH} characters as JSON`,
        }),
      }),
    )
    .output(z.object({ ok: z.literal(true) }).strict())
    .mutation(async ({ ctx, input }) => {
      const result = await saveAssistantVideoTasks(ctx.db, ctx.teacherId, input.videoId.toLowerCase(), input.tasks);
      if (result === "not_found") throw notFound();
      if (result === "edited") {
        throw new TRPCError({ code: "CONFLICT", message: "Учитель уже правит черновик заданий к этому видео: новый сохранится, когда она его подтвердит" });
      }
      if (result !== "saved") throw refuse(result.errors.join("\n"));
      return { ok: true as const };
    }),
});
