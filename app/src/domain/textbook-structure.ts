// A textbook's structure (#150): units, and lessons with their page ranges
// in each book, their tracks (by name) and their words. The assistant saves
// one as a draft; the teacher corrects and confirms it, or enters it by hand.
// Only a confirmed structure is used by lessons. Plain data and zod only.
import { z } from "zod";
import { BOOK_KINDS } from "./textbook";

export const MAX_UNITS = 60;
export const MAX_LESSONS_PER_UNIT = 30;
export const MAX_LESSON_TRACKS = 30;
export const MAX_LESSON_WORDS = 200;

const name = z.string().trim().min(1).max(200);

/** A page range of a book, both ends included, from page 1. */
const range = z
  .object({ from: z.number().int().min(1), to: z.number().int().min(1) })
  .strict()
  .refine((r) => r.from <= r.to, { message: "первая страница больше последней" });

const lesson = z
  .object({
    // Kept across edits, so a lesson planned for a student stays the same lesson; given by the platform when missing.
    id: z.uuid().optional(),
    title: name,
    pages: z.partialRecord(z.enum(BOOK_KINDS), range),
    tracks: z.array(name).max(MAX_LESSON_TRACKS),
    words: z.array(name).max(MAX_LESSON_WORDS),
  })
  .strict();

const unit = z
  .object({ id: z.uuid().optional(), title: name, lessons: z.array(lesson).min(1).max(MAX_LESSONS_PER_UNIT) })
  .strict();

export const structureSchema = z.object({ units: z.array(unit).min(1).max(MAX_UNITS) }).strict();
export type TextbookStructure = z.infer<typeof structureSchema>;
export type StructureLesson = z.infer<typeof lesson>;
/** One lesson of a structure, for outputs that add to it (#291). */
export const structureLessonSchema = lesson;

/** Who wrote a draft: the assistant, or the teacher saving her own edits. */
export const DRAFT_AUTHORS = ["assistant", "teacher"] as const;
export type DraftAuthor = (typeof DRAFT_AUTHORS)[number];

/** One readable line per problem, naming the unit and the lesson. */
export function describeStructureIssue(issue: z.core.$ZodIssue): string {
  const [, u, , l, field, ...rest] = issue.path;
  const where = [
    typeof u === "number" ? `юнит ${u + 1}` : null,
    typeof l === "number" ? `урок ${l + 1}` : null,
    field !== undefined ? [field, ...rest].join(".") : null,
  ].filter(Boolean);
  return `${where.length > 0 ? `${where.join(", ")}: ` : ""}${issue.message}`;
}
