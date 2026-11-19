import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { lessonPlanSchema } from "../../../domain/lesson-plan";
import { MATERIAL_KINDS } from "../../../domain/library";
import { findPreparation, savePlan, setStudentTextbook, studentTextbook, upcomingLessons } from "../../lesson/prep";
import { router, teacherProcedure } from "../core/trpc";

const notFound = () => new TRPCError({ code: "NOT_FOUND" });
const choice = z.object({ id: z.uuid(), label: z.string(), title: z.string() }).strict();

/** «Подготовка» (#151): the teacher's upcoming lessons and their plans. */
export const prepRouter = router({
  list: teacherProcedure
    .input(z.object({ studentId: z.uuid().optional() }))
    .output(
      z.array(
        z
          .object({
            id: z.uuid(),
            studentId: z.uuid(),
            firstName: z.string(),
            startsAt: z.iso.datetime(),
            durationMinutes: z.number().int(),
            prepared: z.boolean(),
            draft: z.boolean(),
          })
          .strict(),
      ),
    )
    .query(async ({ ctx, input }) =>
      (await upcomingLessons(ctx.db, ctx.teacherId, input.studentId)).map((l) => ({ ...l, startsAt: l.startsAt.toISOString() })),
    ),

  get: teacherProcedure
    .input(z.object({ lessonId: z.uuid() }))
    .output(
      z
        .object({
          lessonId: z.uuid(),
          studentId: z.uuid(),
          firstName: z.string(),
          startsAt: z.iso.datetime(),
          durationMinutes: z.number().int(),
          textbookTitle: z.string().nullable(),
          plan: lessonPlanSchema.nullable(),
          draft: lessonPlanSchema.nullable(),
          revision: z.string(),
          proposed: lessonPlanSchema,
          homeworkId: z.uuid().nullable(),
          lessons: z.array(choice),
          materials: z.array(
            z.object({ id: z.uuid(), kind: z.enum(MATERIAL_KINDS), title: z.string(), level: z.string(), topic: z.string().nullable() }).strict(),
          ),
          homeworkDrafts: z.array(z.object({ id: z.uuid(), title: z.string() }).strict()),
        })
        .strict(),
    )
    .query(async ({ ctx, input }) => {
      const found = await findPreparation(ctx.db, ctx.teacherId, input.lessonId);
      if (!found) throw notFound();
      return {
        ...found,
        startsAt: found.startsAt.toISOString(),
        materials: found.materials.map((m) => ({ ...m, kind: m.kind as (typeof MATERIAL_KINDS)[number] })),
      };
    }),

  /** Saves or approves the plan, with the homework draft for the lesson: the lesson is «подготовлен». */
  save: teacherProcedure
    .input(z.object({ lessonId: z.uuid(), plan: z.unknown(), homeworkId: z.uuid().nullable(), revision: z.string().max(64) }))
    .output(z.object({ ok: z.literal(true) }).strict())
    .mutation(async ({ ctx, input }) => {
      const saved = await savePlan(ctx.db, ctx.teacherId, input.lessonId, input.plan, input.homeworkId, input.revision);
      if (saved === "not_found") throw notFound();
      if (saved === "conflict") throw new TRPCError({ code: "CONFLICT", message: "Пока вы правили, ассистент прислал новый план. Обновите страницу" });
      if (typeof saved === "object") throw new TRPCError({ code: "BAD_REQUEST", message: saved.errors.join("\n") });
      return { ok: true as const };
    }),

  /** The student's textbook and passed lesson, for the card (#151). */
  studentTextbook: teacherProcedure
    .input(z.object({ studentId: z.uuid() }))
    .output(
      z
        .object({
          textbookId: z.uuid().nullable(),
          passedLessonId: z.string().nullable(),
          textbooks: z.array(z.object({ id: z.uuid(), title: z.string(), lessons: z.array(choice) }).strict()),
        })
        .strict(),
    )
    .query(async ({ ctx, input }) => {
      const found = await studentTextbook(ctx.db, ctx.teacherId, input.studentId);
      if (!found) throw notFound();
      return found;
    }),

  setStudentTextbook: teacherProcedure
    .input(z.object({ studentId: z.uuid(), textbookId: z.uuid().nullable(), passedLessonId: z.uuid().nullable() }))
    .output(z.object({ ok: z.literal(true) }).strict())
    .mutation(async ({ ctx, input }) => {
      const saved = await setStudentTextbook(ctx.db, ctx.teacherId, input.studentId, input.textbookId, input.passedLessonId);
      if (saved === "not_found") throw notFound();
      if (typeof saved === "object") throw new TRPCError({ code: "BAD_REQUEST", message: saved.error });
      return { ok: true as const };
    }),
});
