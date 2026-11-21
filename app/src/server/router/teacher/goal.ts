import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { findGoal, MEASURE_DAYS, measureValues, saveGoal } from "../../crm/goal";
import { router, teacherProcedure } from "../core/trpc";

// «Цель и показатель» on the student card (#266). Teacher only.

const notFound = () => new TRPCError({ code: "NOT_FOUND" });
const text = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) => (value.trim() === "" ? null : value.trim()));

export const goalRouter = router({
  /** The goal, the measure and its numbers of the last 30 days, oldest first. */
  get: teacherProcedure
    .input(z.object({ studentId: z.uuid() }))
    .output(
      z
        .object({
          familyGoal: z.string().nullable(),
          measureName: z.string().nullable(),
          measureUnit: z.string().nullable(),
          values: z.array(z.number()),
        })
        .strict(),
    )
    .query(async ({ ctx, input }) => {
      const goal = await findGoal(ctx.db, ctx.teacherId, input.studentId);
      if (!goal) throw notFound();
      const now = new Date();
      const values = goal.measureName
        ? await measureValues(ctx.db, ctx.teacherId, input.studentId, new Date(now.getTime() - MEASURE_DAYS * 86_400_000), now)
        : [];
      return { ...goal, values };
    }),

  /** «Сохранить»: the goal and the measure; a unit without a name is dropped. */
  save: teacherProcedure
    .input(z.object({ studentId: z.uuid(), familyGoal: text(1000), measureName: text(100), measureUnit: text(30) }))
    .output(z.object({ ok: z.literal(true) }).strict())
    .mutation(async ({ ctx, input }) => {
      const { studentId, ...goal } = input;
      const saved = await saveGoal(ctx.db, ctx.teacherId, studentId, { ...goal, measureUnit: goal.measureName ? goal.measureUnit : null });
      if (!saved) throw notFound();
      return { ok: true as const };
    }),
});
