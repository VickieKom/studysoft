import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { MATERIAL_KINDS } from "../../../domain/library";
import { lessonPlanSchema } from "../../../domain/lesson-plan";
import { findPreparation, onIntroCard, saveAssistantPlan, stageMaterials, upcomingLessons } from "../../lesson/prep";
import { agentProcedure, router } from "../core/trpc";

// The assistant's lesson preparation (#151): it reads the upcoming lessons
// and saves a plan as a draft. There is no agent procedure that approves a
// plan (AGENTS.md, rule 5): approving is the teacher's. A request's hidden
// card (#338) has no context for the assistant, so its intro lessons are not
// among them (product owner, 2026-11-24).

const notFound = () => new TRPCError({ code: "NOT_FOUND" });

export const agentPrepRouter = router({
  /** The teacher's lessons in the next two weeks, each prepared or not; optionally one student's. */
  upcomingLessons: agentProcedure
    .input(z.object({ studentId: z.uuid().optional() }))
    .output(
      z.array(
        z
          .object({ id: z.uuid(), studentId: z.uuid(), firstName: z.string(), startsAt: z.iso.datetime(), durationMinutes: z.number().int(), prepared: z.boolean() })
          .strict(),
      ),
    )
    .query(async ({ ctx, input }) =>
      (await upcomingLessons(ctx.db, ctx.teacherId, input.studentId, new Date(), { introCards: false })).map(({ draft: _, ...l }) => ({ ...l, startsAt: l.startsAt.toISOString() })),
    ),

  /** A lesson's plan as it stands, the plan proposed (the student's next book lesson), and the lessons of their textbook. */
  lessonPlan: agentProcedure
    .input(z.object({ lessonId: z.uuid() }))
    .output(
      z
        .object({
          plan: lessonPlanSchema.nullable(),
          draft: lessonPlanSchema.nullable(),
          proposed: lessonPlanSchema,
          textbookTitle: z.string().nullable(),
          lessons: z.array(z.object({ id: z.uuid(), label: z.string(), title: z.string() }).strict()),
        })
        .strict(),
    )
    .query(async ({ ctx, input }) => {
      if (await onIntroCard(ctx.db, ctx.teacherId, input.lessonId)) throw notFound();
      const found = await findPreparation(ctx.db, ctx.teacherId, input.lessonId);
      if (!found) throw notFound();
      return { plan: found.plan, draft: found.draft, proposed: found.proposed, textbookTitle: found.textbookTitle, lessons: found.lessons };
    }),

  /** The library materials a plan may take as a stage: warm-ups, games and videos. */
  lessonMaterials: agentProcedure
    .input(z.object({ lessonId: z.uuid() }))
    .output(z.array(z.object({ id: z.uuid(), kind: z.enum(MATERIAL_KINDS), title: z.string(), level: z.string(), topics: z.array(z.string()) }).strict()))
    .query(async ({ ctx, input }) => {
      if ((await onIntroCard(ctx.db, ctx.teacherId, input.lessonId)) || !(await findPreparation(ctx.db, ctx.teacherId, input.lessonId))) throw notFound();
      return (await stageMaterials(ctx.db, ctx.teacherId)).map((m) => ({ ...m, kind: m.kind as (typeof MATERIAL_KINDS)[number] }));
    }),

  /** Saves a plan as the assistant's draft «от ассистента»; the teacher approves, changes or removes stages. */
  saveLessonPlan: agentProcedure
    .input(z.object({ lessonId: z.uuid(), plan: z.unknown() }))
    .output(z.object({ status: z.literal("draft") }).strict())
    .mutation(async ({ ctx, input }) => {
      if (await onIntroCard(ctx.db, ctx.teacherId, input.lessonId)) throw notFound();
      const saved = await saveAssistantPlan(ctx.db, ctx.teacherId, input.lessonId, input.plan);
      if (saved === "not_found") throw notFound();
      if (typeof saved === "object") throw new TRPCError({ code: "BAD_REQUEST", message: saved.errors.join("\n") });
      return { status: "draft" as const };
    }),
});
