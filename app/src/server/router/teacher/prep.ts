import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { lessonPlanSchema } from "../../../domain/lesson-plan";
import { MATERIAL_KINDS } from "../../../domain/library";
import { bookSourceSchema, MAX_LESSON_TASKS } from "../../../domain/task-bank";
import { studentTaskSchema } from "../../../domain/student-task-schema";
import { buildHomeworkFromBank, prepBankTasks } from "../../lesson/bank-homework";
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
          // The plan the page opens with, the waiting homework's review first when it belongs there (#153).
          start: lessonPlanSchema,
          waitingHomework: z.object({ id: z.uuid(), title: z.string() }).strict().nullable(),
          stageHomework: z.array(z.object({ id: z.uuid(), title: z.string() }).strict()),
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
      const { launch: _, ...prep } = found;
      return {
        ...prep,
        startsAt: prep.startsAt.toISOString(),
        materials: prep.materials.map((m) => ({ ...m, kind: m.kind as (typeof MATERIAL_KINDS)[number] })),
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

  /** The confirmed bank tasks of the plan's book lessons, as the child will see them (#226). */
  bankTasks: teacherProcedure
    .input(z.object({ lessonId: z.uuid() }))
    .output(
      z.array(
        z
          .object({
            bookLessonId: z.uuid(),
            title: z.string(),
            textbookId: z.uuid(),
            confirmed: z
              .object({
                tasks: z.array(z.object({ task: studentTaskSchema("/api/files/bank/"), source: bookSourceSchema.nullable() }).strict()),
                revision: z.string(),
              })
              .strict()
              .nullable(),
          })
          .strict(),
      ),
    )
    .query(async ({ ctx, input }) => {
      const found = await prepBankTasks(ctx.db, ctx.teacherId, input.lessonId);
      if (!found) throw notFound();
      return found;
    }),

  /** «Собрать домашку» (#226): the checked bank tasks appended to the lesson's draft, or a new one; attached to the lesson. */
  buildHomework: teacherProcedure
    .input(
      z.object({
        lessonId: z.uuid(),
        bookLessonId: z.uuid(),
        picks: z.array(z.number().int().min(0).max(MAX_LESSON_TASKS - 1)).max(MAX_LESSON_TASKS),
        revision: z.string().max(64),
        homeworkId: z.uuid().nullable(),
      }),
    )
    .output(z.object({ homeworkId: z.uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      const built = await buildHomeworkFromBank(ctx.db, ctx.teacherId, input.lessonId, input.bookLessonId, input.picks, input.revision, input.homeworkId);
      if (built === "not_found") throw notFound();
      if (built === "conflict") throw new TRPCError({ code: "CONFLICT", message: "Задания урока в учебнике изменились. Обновите страницу" });
      if ("errors" in built) throw new TRPCError({ code: "BAD_REQUEST", message: built.errors.join("\n") });
      return built;
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
