// «Что заходит» (#333): the child's answers gathered into two ratings
// (product owner, 2026-11-23) — the kinds of homework tasks, from the
// one-tap question after a homework (#331), and the kinds of lesson
// materials, from the survey's «Что было веселее?» (#332) — and the topics
// the survey's «Про что хочется ещё?» chose, in a list of their own. «3 из 3»
// is chosen in three answers of three. Plain data and pure functions only.
import { ALL_KINDS_ANSWER, CHILD_TASK_KIND_LABELS } from "./homework";
import type { TaskType } from "./homework-format";

/** The kinds of lesson materials a survey pair names. */
export const RATED_MATERIAL_KINDS = ["game", "warmup", "video"] as const;
export type RatedMaterialKind = (typeof RATED_MATERIAL_KINDS)[number];

/** How the ratings name a kind of material: «Игры — 3 из 3». */
export const MATERIAL_KIND_PLURALS: Record<RatedMaterialKind, string> = { game: "Игры", warmup: "Разминки", video: "Видео" };

/** One line of a rating: chosen in `chosen` answers of `of`. */
export type Rated<K extends string> = { key: K; chosen: number; of: number };

const byChosen = <K extends string>(rows: Rated<K>[]) => rows.filter((r) => r.chosen > 0).sort((a, b) => b.chosen - a.chosen || a.key.localeCompare(b.key));

/**
 * The homework's kinds of tasks, over the one-tap answers: an answer names
 * one kind, or «Все классные», which counts for every kind its homework had.
 * A skipped question is no answer.
 */
export function rateTaskKinds(answers: { answer: TaskType | typeof ALL_KINDS_ANSWER; kinds: TaskType[] }[]): Rated<TaskType>[] {
  const chosen = new Map<TaskType, number>();
  for (const { answer, kinds } of answers) {
    for (const kind of answer === ALL_KINDS_ANSWER ? new Set(kinds) : [answer]) chosen.set(kind, (chosen.get(kind) ?? 0) + 1);
  }
  return byChosen([...chosen].map(([key, n]) => ({ key, chosen: n, of: answers.length })));
}

/** One answered «Что было веселее: A или B?»: the kinds of its two materials (null for one no longer there) and the pick. */
export type FunAnswer = { a: RatedMaterialKind | null; b: RatedMaterialKind | null; picked: "a" | "b" | "both" | "neither" };

/** The lesson materials' kinds, over the answered pairs: «Оба классные» counts both, once per kind; «Оба так себе» none. */
export function rateMaterialKinds(answers: FunAnswer[]): Rated<RatedMaterialKind>[] {
  const chosen = new Map<RatedMaterialKind, number>();
  for (const { a, b, picked } of answers) {
    const kinds = picked === "a" ? [a] : picked === "b" ? [b] : picked === "both" ? [...new Set([a, b])] : [];
    for (const kind of kinds) if (kind) chosen.set(kind, (chosen.get(kind) ?? 0) + 1);
  }
  return byChosen([...chosen].map(([key, n]) => ({ key, chosen: n, of: answers.length })));
}

/**
 * For the assistant (#335): the lesson materials' kinds in pairs the child
 * answered «Оба так себе», with how many such pairs and how many pairs the
 * kind was in; the most such first. A kind never in such a pair is left out.
 */
export function rateMehKinds(answers: FunAnswer[]): { key: RatedMaterialKind; meh: number; of: number }[] {
  const meh = new Map<RatedMaterialKind, number>();
  const of = new Map<RatedMaterialKind, number>();
  for (const { a, b, picked } of answers) {
    for (const kind of new Set([a, b])) {
      if (!kind) continue;
      of.set(kind, (of.get(kind) ?? 0) + 1);
      if (picked === "neither") meh.set(kind, (meh.get(kind) ?? 0) + 1);
    }
  }
  return [...meh].map(([key, n]) => ({ key, meh: n, of: of.get(key)! })).sort((x, y) => y.meh - x.meh || x.key.localeCompare(y.key));
}

/** The topics «Про что хочется ещё?» chose, the most chosen first. */
export function rateTopics(chosen: string[]): { topic: string; chosen: number }[] {
  const counts = new Map<string, number>();
  for (const topic of chosen) counts.set(topic, (counts.get(topic) ?? 0) + 1);
  return [...counts].map(([topic, n]) => ({ topic, chosen: n })).sort((a, b) => b.chosen - a.chosen || a.topic.localeCompare(b.topic));
}

const WEEK_MS = 7 * 86_400_000;

/**
 * What «Фидбэк» shows (#333): the week's answers and every answer not seen
 * yet, however old; the rest go under «Все ответы». `seenAt` is when the
 * teacher last saw the block, by the newest answer it showed.
 */
export function splitFeedback<T extends { answeredAt: string }>(answers: T[], seenAt: string | null, now: number): { shown: T[]; older: T[] } {
  const seen = seenAt === null ? Number.NEGATIVE_INFINITY : Date.parse(seenAt);
  const isShown = (a: T) => Date.parse(a.answeredAt) >= now - WEEK_MS || Date.parse(a.answeredAt) > seen;
  return { shown: answers.filter(isShown), older: answers.filter((a) => !isShown(a)) };
}

/** The newest of these answers, the time «Фидбэк» is seen up to; null when there is none. */
export function newestAnswer(answers: { answeredAt: string }[]): string | null {
  return answers.reduce<string | null>((newest, a) => (newest === null || Date.parse(a.answeredAt) > Date.parse(newest) ? a.answeredAt : newest), null);
}

/** «Игры — 3 из 3». */
export const ratedLine = (label: string, rated: Rated<string>) => `${label} — ${rated.chosen} из ${rated.of}`;
export const materialLabel = (kind: RatedMaterialKind) => MATERIAL_KIND_PLURALS[kind];
export const taskKindLabel = (kind: TaskType) => CHILD_TASK_KIND_LABELS[kind];

/**
 * What the child likes most, for «Прогресс»: the top kind of lesson
 * material, else the top kind of homework task, in lower case
 * («игры»); null when nothing was chosen yet.
 */
export function likedMost(materials: Rated<RatedMaterialKind>[], tasks: Rated<TaskType>[]): string | null {
  if (materials[0]) return materialLabel(materials[0].key).toLowerCase();
  if (tasks[0]) return taskKindLabel(tasks[0].key).toLowerCase();
  return null;
}

/** The periods of «Что заходит» on the card (#377): all the answers, or those of the last `RATING_MONTH_DAYS` days. */
export const RATING_PERIODS = ["all", "month"] as const;
export type RatingPeriod = (typeof RATING_PERIODS)[number];
export const RATING_MONTH_DAYS = 30;

/** The moment a period's answers start from; null for all time. */
export function ratingSince(period: RatingPeriod, now: Date): Date | null {
  return period === "month" ? new Date(now.getTime() - RATING_MONTH_DAYS * 86_400_000) : null;
}
