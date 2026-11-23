import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ASSESSMENT_FORMAT_VERSION, validateAssessment } from "../../../domain/assessment-format";
import { assessmentPeriod, MAX_ASSESSMENT_LENGTH, saveAssistantAssessment } from "../../assessment/assessments";
import { ASSESSMENT_FORMAT_DESCRIPTION } from "../../assessment/format-description";
import { findStudent } from "../../crm/students";
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
   * like the teacher's import and no longer than it as JSON. Replaces the
   * assistant's draft while the teacher has done nothing to it, or makes a
   * new one. The draft keeps only the period it was drafted from, not the
   * rest of the student context: notes and results stay where the teacher
   * can delete them.
   */
  saveAssessmentDraft: agentProcedure
    .input(
      z.object({
        studentId: z.uuid(),
        assessment: z.unknown().refine((value) => (JSON.stringify(value) ?? "").length <= MAX_ASSESSMENT_LENGTH, {
          message: `The assessment is longer than ${MAX_ASSESSMENT_LENGTH} characters as JSON`,
        }),
      }),
    )
    .output(z.object({ id: z.uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      if (!(await findStudent(ctx.db, ctx.teacherId, input.studentId))) throw new TRPCError({ code: "NOT_FOUND" });
      const checked = validateAssessment(input.assessment);
      if (!checked.ok) throw new TRPCError({ code: "BAD_REQUEST", message: checked.errors.join("\n") });
      const period = await assessmentPeriod(ctx.db, ctx.teacherId, input.studentId);
      return { id: await saveAssistantAssessment(ctx.db, ctx.teacherId, input.studentId, checked.assessment, { assessmentPeriod: period }) };
    }),
});
