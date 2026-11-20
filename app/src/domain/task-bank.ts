// The workbook task bank (#224): a textbook lesson's tasks in the homework
// format, each with the exercise it comes from, and the exercises that did
// not become tasks, each with its reason. Plain data and zod only.
import { z } from "zod";
import { bookSourceSchema } from "./homework-format";

/** As many tasks as a homework holds. */
export const MAX_LESSON_TASKS = 50;
export const MAX_SKIPPED = 50;
export const MAX_REASON_CHARS = 300;

export { bookSourceSchema };
export type BookSource = z.infer<typeof bookSourceSchema>;

export const skippedSchema = z
  .array(z.object({ source: bookSourceSchema, reason: z.string().trim().min(1).max(MAX_REASON_CHARS) }).strict())
  .max(MAX_SKIPPED);
export type SkippedExercise = z.infer<typeof skippedSchema>[number];

/** «Workbook, юнит 1, с. 5, упр. 2»: the parts the source has. */
export function sourceLabel(source: BookSource): string {
  return [
    source.book,
    source.unit ? `юнит ${source.unit}` : null,
    source.page ? `с. ${source.page}` : null,
    source.exercise ? `упр. ${source.exercise}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/** A lesson's confirmed tasks, or the draft beside them. */
export const BANK_LISTS = ["tasks", "draft"] as const;
export type BankList = (typeof BANK_LISTS)[number];

/** Where a bank task's picture, recording or part picture is served: to its teacher only. */
export function bankFileUrl(entryId: string, list: BankList, taskIndex: number, part: "image" | "audio" | { picture: number } = "image"): string {
  const base = `/api/files/bank/${entryId}/${list}/${taskIndex}`;
  if (part === "image") return base;
  if (part === "audio") return `${base}/audio`;
  return `${base}/pictures/${part.picture}`;
}
