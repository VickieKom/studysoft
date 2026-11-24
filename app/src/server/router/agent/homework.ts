import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { GAME_RESULT_FORMAT_VERSION } from "../../../domain/game-result-format";
import { GAME_WORDS_VERSION } from "../../../domain/game-words-format";
import { HOMEWORK_FORMAT_VERSION, homeworkSchema, validateHomework } from "../../../domain/homework-format";
import { buildStudentContext } from "../../crm/context";
import { readAssistantDraft, replaceableDraft, saveAssistantDraft } from "../../homework/drafts";
import { HOMEWORK_FORMAT_DESCRIPTION } from "../../homework/format-description";
import { taskFileRefs, storeTaskFiles } from "../../homework/images";
import { MissingVideoError, taskVideoErrors } from "../../homework/videos";
import { GAME_RESULT_FORMAT_DESCRIPTION } from "../../library/game-result-format-description";
import { GAME_WORDS_FORMAT_DESCRIPTION } from "../../library/game-words-format-description";
import { agentProcedure, router } from "../core/trpc";

// The assistant's homework tools (#43). Drafts only: there is no agent
// procedure that publishes, takes back or deletes (AGENTS.md, rule 5).

const notFound = () => new TRPCError({ code: "NOT_FOUND" });
const forStudent = z.object({ studentId: z.uuid() });

export const agentHomeworkRouter = router({
  /** The homework format the platform accepts, with its version. */
  homeworkFormat: agentProcedure
    .output(z.object({ version: z.literal(HOMEWORK_FORMAT_VERSION), description: z.string() }).strict())
    .query(() => ({ version: HOMEWORK_FORMAT_VERSION, description: HOMEWORK_FORMAT_DESCRIPTION })),

  /** How a game reports the student's answers to the platform (#119), with its version: games the assistant makes use it from the start. */
  gameResultFormat: agentProcedure
    .output(z.object({ version: z.literal(GAME_RESULT_FORMAT_VERSION), description: z.string() }).strict())
    .query(() => ({ version: GAME_RESULT_FORMAT_VERSION, description: GAME_RESULT_FORMAT_DESCRIPTION })),

  /** How a game template gets a student's words (#282), with its version. */
  gameWordsFormat: agentProcedure
    .output(z.object({ version: z.literal(GAME_WORDS_VERSION), description: z.string() }).strict())
    .query(() => ({ version: GAME_WORDS_VERSION, description: GAME_WORDS_FORMAT_DESCRIPTION })),

  /**
   * Saves a homework as the assistant's draft for a student, validated like
   * the teacher's import. Replaces the assistant's untouched draft, or makes
   * a new one once the teacher has edited hers.
   */
  saveHomeworkDraft: agentProcedure
    .input(forStudent.extend({ homework: z.unknown() }))
    .output(z.object({ id: z.uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      const context = await buildStudentContext(ctx.db, ctx.teacherId, input.studentId);
      if (!context) throw notFound();
      const checked = validateHomework(input.homework);
      if (!checked.ok) throw new TRPCError({ code: "BAD_REQUEST", message: checked.errors.join("\n") });
      // A task's video (#330) is one of this teacher's library videos.
      const videoErrors = await taskVideoErrors(ctx.db, ctx.teacherId, checked.homework);
      if (videoErrors.length > 0) throw new TRPCError({ code: "BAD_REQUEST", message: videoErrors.join("\n") });
      // A picture already stored may stay only in the draft being replaced.
      const replaced = await replaceableDraft(ctx.db, ctx.teacherId, input.studentId);
      const stored = await storeTaskFiles(ctx.db, ctx.teacherId, checked.homework, replaced ? taskFileRefs(replaced.document) : new Set());
      if (!stored.ok) throw new TRPCError({ code: "BAD_REQUEST", message: stored.errors.join("\n") });
      // The draft found above is checked again under a lock before it is replaced.
      try {
        return { id: await saveAssistantDraft(ctx.db, ctx.teacherId, input.studentId, replaced, stored.homework, context) };
      } catch (error) {
        // A library video deleted after the check above (#330).
        if (error instanceof MissingVideoError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        throw error;
      }
    }),

  /** The assistant's latest draft for a student, to revise it; null when there is none. */
  readHomeworkDraft: agentProcedure
    .input(forStudent)
    .output(z.object({ id: z.uuid(), homework: homeworkSchema }).strict().nullable())
    .query(async ({ ctx, input }) => {
      if (!(await buildStudentContext(ctx.db, ctx.teacherId, input.studentId))) throw notFound();
      return readAssistantDraft(ctx.db, ctx.teacherId, input.studentId);
    }),
});
