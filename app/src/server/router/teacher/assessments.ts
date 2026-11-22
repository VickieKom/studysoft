import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { assessmentFileUrl } from "../../../domain/assessment";
import { ASSESSMENT_SECTIONS, assessmentSectionViewSchema, assessmentView, parseAssessment } from "../../../domain/assessment-format";
import { approveAssessment, type AssessmentRow, importAssessment, listAssessments, MAX_ASSESSMENT_LENGTH, removeQuestion } from "../../assessment/assessments";
import { finishAssessment, lessonStudent, openAssessmentToStudent, TAKING_STATUSES, takingStatus } from "../../assessment/taking";
import { findStudent } from "../../crm/students";
import { router, teacherProcedure } from "../core/trpc";

// «Замеры» on the student card (#252): the monthly assessment imported as a
// draft, shown by section as the child will see it, corrected and approved.
// The output carries no keys: the assessment as the child sees it, its
// status and its files' addresses.

const notFound = () => new TRPCError({ code: "NOT_FOUND" });
/** The revision the page has seen, as `list` gave it (an md5 in hex). */
const revision = z.string().max(64);
const changed = () => new TRPCError({ code: "CONFLICT", message: "Замер изменился. Обновите страницу" });

const assessmentViewSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    status: z.enum(["draft", "approved"]),
    fromAssistant: z.boolean(),
    sections: z.array(assessmentSectionViewSchema),
    recording: z.string().nullable(),
    picture: z.string().nullable(),
    revision,
    // Taken in a lesson (#253): how far the child is, and the speaking recording from the panel.
    taking: z.enum(TAKING_STATUSES),
    openUntil: z.iso.datetime().nullable(),
    speakingRecording: z.string().nullable(),
  })
  .strict();

const view = (row: AssessmentRow) => ({
  id: row.id,
  title: row.title,
  status: row.status,
  fromAssistant: row.fromAssistant,
  sections: assessmentView(row.document),
  recording: row.listeningRecording ? assessmentFileUrl(row.id, "listening") : null,
  picture: row.speakingPicture ? assessmentFileUrl(row.id, "picture") : null,
  revision: row.revision,
  taking: takingStatus(row),
  openUntil: row.openUntil?.toISOString() ?? null,
  speakingRecording: row.speakingRecording ? assessmentFileUrl(row.id, "speaking") : null,
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
    .input(z.object({ studentId: z.uuid(), json: z.string().max(MAX_ASSESSMENT_LENGTH) }))
    .output(z.object({ id: z.uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      if (!(await findStudent(ctx.db, ctx.teacherId, input.studentId))) throw notFound();
      const parsed = parseAssessment(input.json);
      if (!parsed.ok) throw new TRPCError({ code: "BAD_REQUEST", message: parsed.errors.join("\n") });
      return { id: await importAssessment(ctx.db, ctx.teacherId, input.studentId, parsed.assessment) };
    }),

  /** «Убрать»: one question of the draft the page has seen. */
  removeQuestion: teacherProcedure
    .input(z.object({ assessmentId: z.uuid(), revision, section: z.enum(ASSESSMENT_SECTIONS), index: z.number().int().min(0) }))
    .output(ok)
    .mutation(async ({ ctx, input }) => {
      const result = await removeQuestion(ctx.db, ctx.teacherId, input.assessmentId, input.revision, input.section, input.index);
      if (result === "not_found") throw notFound();
      if (result === "not_removable") throw new TRPCError({ code: "BAD_REQUEST", message: "Этот вопрос убрать нельзя: в замере должен остаться хотя бы один" });
      if (result === "changed") throw changed();
      return { ok: true as const };
    }),

  /**
   * «Утвердить»: the draft the page has seen is fixed; refused when it changed
   * since, and without the recording when it has «Аудирование».
   */
  approve: teacherProcedure
    .input(z.object({ assessmentId: z.uuid(), revision }))
    .output(ok)
    .mutation(async ({ ctx, input }) => {
      const result = await approveAssessment(ctx.db, ctx.teacherId, input.assessmentId, input.revision);
      if (result === "not_found") throw notFound();
      if (result === "changed") throw changed();
      if (result === "no_recording") throw new TRPCError({ code: "BAD_REQUEST", message: "Нет записи для аудирования. Загрузите её и утвердите снова" });
      return { ok: true as const };
    }),

  /** «Открыть ученику» (#253): while a lesson with the student is going on, until its end. */
  open: teacherProcedure
    .input(z.object({ assessmentId: z.uuid() }))
    .output(z.object({ until: z.iso.datetime() }).strict())
    .mutation(async ({ ctx, input }) => {
      const result = await openAssessmentToStudent(ctx.db, ctx.teacherId, input.assessmentId);
      if (result === "not_found") throw notFound();
      if (result === "not_approved") throw new TRPCError({ code: "BAD_REQUEST", message: "Сначала утвердите замер" });
      if (result === "ended") throw new TRPCError({ code: "BAD_REQUEST", message: "Замер уже сдан" });
      if (result === "no_lesson") throw new TRPCError({ code: "BAD_REQUEST", message: "Открыть можно, пока идёт урок с учеником" });
      return { until: result.until.toISOString() };
    }),

  /** «Завершить замер» (#253): unanswered questions count as wrong, a section not started is not scored. */
  finish: teacherProcedure
    .input(z.object({ assessmentId: z.uuid() }))
    .output(ok)
    .mutation(async ({ ctx, input }) => {
      const result = await finishAssessment(ctx.db, ctx.teacherId, input.assessmentId);
      if (result === "not_found") throw notFound();
      if (result === "ended") throw new TRPCError({ code: "BAD_REQUEST", message: "Замер уже сдан" });
      return { ok: true as const };
    }),

  /** «Замер» on the lesson panel (#253): the lesson's student's approved assessments still to be taken. */
  forLesson: teacherProcedure
    .input(z.object({ lessonId: z.uuid() }))
    .output(z.array(assessmentViewSchema))
    .query(async ({ ctx, input }) => {
      const studentId = await lessonStudent(ctx.db, ctx.teacherId, input.lessonId);
      if (!studentId) throw notFound();
      return (await listAssessments(ctx.db, ctx.teacherId, studentId))
        .filter((row) => row.status === "approved" && !row.submittedAt && !row.finishedAt)
        .map(view);
    }),
});
