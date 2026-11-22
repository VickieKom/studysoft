import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ASSESSMENT_FORMAT_VERSION, validateAssessment } from "../../../domain/assessment-format";
import { saveAssistantAssessment } from "../../assessment/assessments";
import { ASSESSMENT_FORMAT_DESCRIPTION } from "../../assessment/format-description";
import { buildStudentContext } from "../../crm/context";
import { agentProcedure, router } from "../core/trpc";

// The assistant's assessment tools (#313). Drafts only: approving, the
// recording and the picture stay with the teacher (AGENTS.md, rule 5).

export const agentAssessmentsRouter = router({
  /** The assessment format the platform accepts, with its version. */
  assessmentFormat: agentProcedure
    .output(z.object({ version: z.literal(ASSESSMENT_FORMAT_VERSION), description: z.string() }).strict())
    .query(() => ({ version: ASSESSMENT_FORMAT_VERSION, description: ASSESSMENT_FORMAT_DESCRIPTION })),

  /**
   * Saves an assessment as the assistant's draft for a student, validated
   * like the teacher's import. Replaces the assistant's draft while the
   * teacher has done nothing to it, or makes a new one.
   */
  saveAssessmentDraft: agentProcedure
    .input(z.object({ studentId: z.uuid(), assessment: z.unknown() }))
    .output(z.object({ id: z.uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      const context = await buildStudentContext(ctx.db, ctx.teacherId, input.studentId);
      if (!context) throw new TRPCError({ code: "NOT_FOUND" });
      const checked = validateAssessment(input.assessment);
      if (!checked.ok) throw new TRPCError({ code: "BAD_REQUEST", message: checked.errors.join("\n") });
      return { id: await saveAssistantAssessment(ctx.db, ctx.teacherId, input.studentId, checked.assessment, context) };
    }),
});
