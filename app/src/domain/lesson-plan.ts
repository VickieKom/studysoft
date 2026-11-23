// The plan of a lesson (#151): its stages in order, with minutes. A book
// stage is a lesson of the student's textbook, with the exercises to skip as
// the teacher writes them («3, 5»); a material stage is a warm-up, a game or a
// video from «Библиотека»; a textbook video stage is a video of the textbook's
// lesson with tasks from its bank (#329); a homework stage reviews the student's submitted
// homework on the stage (#153). Plain data, zod and pure functions only.
import { z } from "zod";

export const MAX_STAGES = 20;
export const MAX_STAGE_MINUTES = 180;

const minutes = z.number().int().min(0).max(MAX_STAGE_MINUTES);
/** The most bank tasks a textbook video stage takes, as a library video's tasks (#326). */
export const MAX_STAGE_VIDEO_TASKS = 20;
/** The minutes a textbook video stage is given when added. */
export const VIDEO_STAGE_MINUTES = 10;

const stage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("book"), lessonId: z.uuid(), skip: z.string().trim().max(200), minutes }).strict(),
  z.object({ type: z.literal("material"), materialId: z.uuid(), minutes }).strict(),
  z.object({ type: z.literal("homework"), homeworkId: z.uuid(), minutes }).strict(),
  // A video of the student's textbook (#329), of the book lesson `lessonId`, with tasks of that lesson's bank by position.
  z
    .object({
      type: z.literal("textbook_video"),
      fileId: z.uuid(),
      lessonId: z.uuid(),
      tasks: z.array(z.number().int().min(0).max(49)).max(MAX_STAGE_VIDEO_TASKS),
      minutes,
    })
    .strict(),
]);

export const lessonPlanSchema = z.object({ stages: z.array(stage).max(MAX_STAGES) }).strict();
export type LessonPlan = z.infer<typeof lessonPlanSchema>;
export type PlanStage = z.infer<typeof stage>;

/** The kinds of library materials a plan takes as a stage. */
export const STAGE_MATERIAL_KINDS = ["warmup", "game", "video"] as const;

/** The minutes a homework stage is given when the platform proposes it. */
export const HOMEWORK_STAGE_MINUTES = 10;

/** The homework waiting for review (#153): the student's latest submitted one, submitted after their previous held lesson. */
export type WaitingHomework = { id: string; title: string; submittedAt: Date };

/**
 * The plan with the waiting homework's stage first (product owner,
 * 2026-11-19). It is added unless the plan has it already, or the teacher
 * saved the plan after the homework was submitted — she saw the stage then,
 * so its absence is her choice. `savedAt` is null for a plan she has not
 * saved: the one proposed or the assistant's draft.
 */
export function withWaitingHomework(plan: LessonPlan, waiting: WaitingHomework | null, savedAt: Date | null): LessonPlan {
  if (!waiting) return plan;
  if (plan.stages.some((s) => s.type === "homework" && s.homeworkId === waiting.id)) return plan;
  if (savedAt && savedAt >= waiting.submittedAt) return plan;
  const stage: PlanStage = { type: "homework", homeworkId: waiting.id, minutes: HOMEWORK_STAGE_MINUTES };
  return { stages: [stage, ...plan.stages].slice(0, MAX_STAGES) };
}
