import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { assessmentFileUrl } from "../../../domain/assessment";
import { MAX_LISTENING_PLAYS } from "../../../domain/assessment-answers";
import { ASSESSMENT_SECTIONS, assessmentSectionViewSchema, assessmentView } from "../../../domain/assessment-format";
import { saveAnswer, startListening, studentAssessment, studentAssessments, submitAssessment } from "../../assessment/taking";
import { router, studentProcedure } from "../core/trpc";

// The monthly assessment the teacher opened to the student in a lesson
// (#253): the questions as the child sees them, their own answers, how many
// plays of «Аудирование» are left, and whether it is handed in. Never a key,
// a score, the speaking recording or the teacher's view; an assessment not
// open to this student is the same NOT_FOUND as a missing one.

const notFound = () => new TRPCError({ code: "NOT_FOUND" });
const ok = z.object({ ok: z.literal(true) }).strict();

const childAssessment = z
  .object({
    id: z.uuid(),
    title: z.string(),
    sections: z.array(assessmentSectionViewSchema.omit({ removable: true }).strict()),
    answers: z.partialRecord(z.enum(ASSESSMENT_SECTIONS), z.array(z.string().nullable())),
    listening: z.object({ playsLeft: z.number().int().min(0), url: z.string().nullable() }).strict().nullable(),
    picture: z.string().nullable(),
    submitted: z.boolean(),
  })
  .strict();

export const studentAssessmentsRouter = router({
  /** The assessments open to the student now, for «Материалы урока». */
  list: studentProcedure
    .output(z.array(z.object({ id: z.uuid(), title: z.string() }).strict()))
    .query(({ ctx }) => studentAssessments(ctx.db, ctx.teacherId, ctx.studentId)),

  get: studentProcedure
    .input(z.object({ id: z.uuid() }))
    .output(childAssessment)
    .query(async ({ ctx, input }) => {
      const id = input.id.toLowerCase();
      const found = await studentAssessment(ctx.db, ctx.teacherId, ctx.studentId, id);
      if (!found) throw notFound();
      const hasListening = found.document.sections.some((s) => s.skill === "listening");
      const hasPicture = found.document.sections.some((s) => s.skill === "speaking");
      const playsLeft = Math.max(0, MAX_LISTENING_PLAYS - found.listeningPlays);
      return {
        id: found.id,
        title: found.title,
        sections: assessmentView(found.document).map(({ removable: _removable, ...section }) => section),
        answers: found.answers,
        listening: hasListening
          ? { playsLeft, url: found.hasRecording && !found.submitted && playsLeft > 0 ? assessmentFileUrl(found.id, "listening") : null }
          : null,
        picture: hasPicture && found.hasPicture ? assessmentFileUrl(found.id, "picture") : null,
        submitted: found.submitted,
      };
    }),

  /** One answer, kept as the child goes. */
  answer: studentProcedure
    .input(z.object({ id: z.uuid(), section: z.enum(ASSESSMENT_SECTIONS), index: z.number().int().min(0), value: z.string().max(5000).nullable() }))
    .output(ok)
    .mutation(async ({ ctx, input }) => {
      const result = await saveAnswer(ctx.db, ctx.teacherId, ctx.studentId, input.id.toLowerCase(), input.section, input.index, input.value);
      if (result === "not_found") throw notFound();
      if (result === "invalid") throw new TRPCError({ code: "BAD_REQUEST", message: "Такого ответа нет" });
      return { ok: true as const };
    }),

  /** The child starts «Аудирование»: one of the plays is used. */
  play: studentProcedure
    .input(z.object({ id: z.uuid() }))
    .output(z.object({ playsLeft: z.number().int().min(0) }).strict())
    .mutation(async ({ ctx, input }) => {
      const plays = await startListening(ctx.db, ctx.teacherId, ctx.studentId, input.id.toLowerCase());
      if (plays === null) throw new TRPCError({ code: "FORBIDDEN", message: "Запись прослушана дважды" });
      return { playsLeft: Math.max(0, MAX_LISTENING_PLAYS - plays) };
    }),

  /** «Сдать». */
  submit: studentProcedure
    .input(z.object({ id: z.uuid() }))
    .output(ok)
    .mutation(async ({ ctx, input }) => {
      if (!(await submitAssessment(ctx.db, ctx.teacherId, ctx.studentId, input.id.toLowerCase()))) throw notFound();
      return { ok: true as const };
    }),
});
