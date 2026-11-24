import { z } from "zod";
import { RATED_MATERIAL_KINDS } from "../../../domain/feedback-rating";
import { TASK_TYPES } from "../../../domain/homework-format";

const rated = <T extends readonly [string, ...string[]]>(keys: T) =>
  z.array(z.object({ key: z.enum(keys), chosen: z.number().int(), of: z.number().int() }).strict());

/** «Что заходит» (#333): the two ratings and the topics, as the card and the general screen show them. */
export const feedbackRatingSchema = z
  .object({
    tasks: rated(TASK_TYPES),
    materials: rated(RATED_MATERIAL_KINDS),
    topics: z.array(z.object({ topic: z.string(), chosen: z.number().int() }).strict()),
  })
  .strict();
