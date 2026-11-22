import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { assessmentFileUrl } from "../../../domain/assessment";
import { ASSESSMENT_SECTIONS, assessmentSectionViewSchema, assessmentView, parseAssessment } from "../../../domain/assessment-format";
import { approveAssessment, type AssessmentRow, importAssessment, listAssessments, removeQuestion } from "../../assessment/assessments";
import { findStudent } from "../../crm/students";
import { router, teacherProcedure } from "../core/trpc";

// «Замеры» on the student card (#252): the monthly assessment imported as a
// draft, shown by section as the child will see it, corrected and approved.
// The output carries no keys: the assessment as the child sees it, its
// status and its files' addresses.

const notFound = () => new TRPCError({ code: "NOT_FOUND" });
/** The JSON of an assessment: text only, its files are uploaded on the card. */
const MAX_IMPORT_LENGTH = 200_000;

const assessmentViewSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    status: z.enum(["draft", "approved"]),
    sections: z.array(assessmentSectionViewSchema),
    recording: z.string().nullable(),
    picture: z.string().nullable(),
  })
  .strict();

const view = (row: AssessmentRow) => ({
  id: row.id,
  title: row.title,
  status: row.status,
  sections: assessmentView(row.document),
  recording: row.listeningRecording ? assessmentFileUrl(row.id, "listening") : null,
  picture: row.speakingPicture ? assessmentFileUrl(row.id, "picture") : null,
});

const ok = z.object({ ok: z.literal(true) }).strict();

export const assessmentsRouter = router({
  /** The student's assessments, the newest first. */
  list: teacherProcedure
    .input(z.object({ studentId: z.uuid() }))
    .output(z.array(assessmentViewSchema))
    .query(async ({ ctx, input }) => {
      if (!(await findStudent(ctx.db, ctx.teacherId, input.studentId))) throw notFound();
      return (await listAssessments(ctx.db, ctx.teacherId, input.studentId)).map(view);
    }),

  /** «Импортировать»: the pasted JSON as the student's draft; the message names the section, the question and the field. */
  import: teacherProcedure
    .input(z.object({ studentId: z.uuid(), json: z.string().max(MAX_IMPORT_LENGTH) }))
    .output(z.object({ id: z.uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      if (!(await findStudent(ctx.db, ctx.teacherId, input.studentId))) throw notFound();
      const parsed = parseAssessment(input.json);
      if (!parsed.ok) throw new TRPCError({ code: "BAD_REQUEST", message: parsed.errors.join("\n") });
      return { id: await importAssessment(ctx.db, ctx.teacherId, input.studentId, parsed.assessment) };
    }),

  /** «Убрать»: one question of a draft. */
  removeQuestion: teacherProcedure
    .input(z.object({ assessmentId: z.uuid(), section: z.enum(ASSESSMENT_SECTIONS), index: z.number().int().min(0) }))
    .output(ok)
    .mutation(async ({ ctx, input }) => {
      const result = await removeQuestion(ctx.db, ctx.teacherId, input.assessmentId, input.section, input.index);
      if (result === "not_found") throw notFound();
      if (result === "not_removable") throw new TRPCError({ code: "BAD_REQUEST", message: "Этот вопрос убрать нельзя: в замере должен остаться хотя бы один" });
      if (result === "changed") throw new TRPCError({ code: "CONFLICT", message: "Замер изменился. Обновите страницу" });
      return { ok: true as const };
    }),

  /** «Утвердить»: the draft is fixed; refused without the recording when it has «Аудирование». */
  approve: teacherProcedure
    .input(z.object({ assessmentId: z.uuid() }))
    .output(ok)
    .mutation(async ({ ctx, input }) => {
      const result = await approveAssessment(ctx.db, ctx.teacherId, input.assessmentId);
      if (result === "not_found") throw notFound();
      if (result === "no_recording") throw new TRPCError({ code: "BAD_REQUEST", message: "Нет записи для аудирования. Загрузите её и утвердите снова" });
      return { ok: true as const };
    }),
});
