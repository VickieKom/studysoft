// Points of a submission (#161). Every task counts one point, except an
// order task of several sentences, which counts one per sentence. A point is
// right, wrong, or waiting for the teacher; her mark wins over the platform's
// result (#36).
import { z } from "zod";

const sentenceVerdictsSchema = z.array(z.object({ correct: z.boolean(), mark: z.boolean().nullable() }).strict());
export type SentenceVerdicts = z.infer<typeof sentenceVerdictsSchema>;

/** A stored answer's results as the database keeps them. */
export type StoredVerdicts = { correct: boolean | null; mark: boolean | null; sentences: unknown };

/** Each sentence's result and the teacher's mark on it, or null for a task of one point. */
export function sentenceVerdicts(sentences: unknown): SentenceVerdicts | null {
  if (sentences === null || sentences === undefined) return null;
  const parsed = sentenceVerdictsSchema.safeParse(sentences);
  return parsed.success ? parsed.data : null;
}

/** Each point of an answer: the teacher's mark if any, else the platform's result; null while it waits for her. */
export function pointVerdicts(row: StoredVerdicts): (boolean | null)[] {
  const sentences = sentenceVerdicts(row.sentences);
  return sentences ? sentences.map((s) => s.mark ?? s.correct) : [row.mark ?? row.correct];
}

/** A task as a whole: wrong when any point is wrong, waiting when any waits, right otherwise. */
export function taskVerdict(points: (boolean | null)[]): boolean | null {
  return points.includes(false) ? false : points.includes(null) ? null : true;
}

/** The score of a submission from its stored answers. */
export function countPoints(rows: StoredVerdicts[]): { correct: number; wrong: number; pending: number } {
  const points = rows.flatMap(pointVerdicts);
  return {
    correct: points.filter((p) => p === true).length,
    wrong: points.filter((p) => p === false).length,
    pending: points.filter((p) => p === null).length,
  };
}
