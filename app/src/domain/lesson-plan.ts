// The plan of a lesson (#151): its stages in order, with minutes. A book
// stage is a lesson of the student's textbook, with the exercises to skip as
// the teacher writes them («3, 5»); a material stage is a warm-up, a game or a
// video from «Библиотека». Plain data and zod only.
import { z } from "zod";

export const MAX_STAGES = 20;
export const MAX_STAGE_MINUTES = 180;

const minutes = z.number().int().min(0).max(MAX_STAGE_MINUTES);

const stage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("book"), lessonId: z.uuid(), skip: z.string().trim().max(200), minutes }).strict(),
  z.object({ type: z.literal("material"), materialId: z.uuid(), minutes }).strict(),
]);

export const lessonPlanSchema = z.object({ stages: z.array(stage).max(MAX_STAGES) }).strict();
export type LessonPlan = z.infer<typeof lessonPlanSchema>;
export type PlanStage = z.infer<typeof stage>;

/** The kinds of library materials a plan takes as a stage. */
export const STAGE_MATERIAL_KINDS = ["warmup", "game", "video"] as const;
