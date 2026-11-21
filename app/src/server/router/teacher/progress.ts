import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { PROGRESS_SKILLS } from "../../../domain/progress";
import { deleteSkillResults, listSkillResults, progressTotals, saveSkillResults } from "../../crm/progress";
import { findStudent } from "../../crm/students";
import { router, teacherProcedure } from "../core/trpc";

// «Прогресс» on the student card (#255): results by skill entered by hand,
// and the totals the dashboard shows beside them. The teacher's only.

const skill = z.enum(PROGRESS_SKILLS);
const percent = z.number().int().min(0).max(100);
const notFound = () => new TRPCError({ code: "NOT_FOUND" });

export const progressRouter = router({
  /** The results, oldest first, and the homework, textbook and words totals. */
  get: teacherProcedure
    .input(z.object({ studentId: z.uuid() }))
    .output(
      z
        .object({
          results: z.array(z.object({ skill, percent, measuredOn: z.iso.date() }).strict()),
          homework: z.object({ submitted: z.number().int(), due: z.number().int() }).strict(),
          textbook: z.object({ title: z.string(), unitsPassed: z.number().int(), units: z.number().int() }).strict().nullable(),
          words: z.object({ total: z.number().int(), learnt: z.number().int() }).strict(),
        })
        .strict(),
    )
    .query(async ({ ctx, input }) => {
      if (!(await findStudent(ctx.db, ctx.teacherId, input.studentId))) throw notFound();
      return { results: await listSkillResults(ctx.db, ctx.teacherId, input.studentId), ...(await progressTotals(ctx.db, ctx.teacherId, input.studentId)) };
    }),

  /** «Внести результаты» or «Изменить»: the results of a date, replacing that date's (and `previousDate`'s when the date was changed). */
  save: teacherProcedure
    .input(
      z.object({
        studentId: z.uuid(),
        date: z.iso.date(),
        previousDate: z.iso.date().nullable(),
        results: z.partialRecord(skill, percent),
      }),
    )
    .output(z.object({ ok: z.literal(true) }).strict())
    .mutation(async ({ ctx, input }) => {
      if (!(await findStudent(ctx.db, ctx.teacherId, input.studentId))) throw notFound();
      if (Object.keys(input.results).length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Укажите хотя бы один навык" });
      await saveSkillResults(ctx.db, ctx.teacherId, input.studentId, input.date, input.results, input.previousDate);
      return { ok: true as const };
    }),

  /** «Удалить»: the results of one date. */
  delete: teacherProcedure
    .input(z.object({ studentId: z.uuid(), date: z.iso.date() }))
    .output(z.object({ ok: z.literal(true) }).strict())
    .mutation(async ({ ctx, input }) => {
      if (!(await findStudent(ctx.db, ctx.teacherId, input.studentId))) throw notFound();
      await deleteSkillResults(ctx.db, ctx.teacherId, input.studentId, input.date);
      return { ok: true as const };
    }),
});
