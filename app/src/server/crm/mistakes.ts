// One list of a student's mistakes by topic (#119): the wrong answers of
// submitted homework, of games played behind the student's link, and of a
// video's tasks answered under it (#327), over the
// last 30 days. The student card shows it as «Ошибки по темам»; the student
// context gives the assistant its summary by topic.
import type { Database } from "../db/client";
import { homeworkMistakes, NO_TOPIC } from "../homework/review";
import { type CountedGameResult, countedGameResults } from "../library/game-results";
import { videoMistakes } from "../library/video-answers";

/** How far back the list goes (product owner, 2026-11-18). */
export const MISTAKES_DAYS = 30;
const DAY_MS = 86_400_000;

/** Where a mistake came from: homework, a game the student played by their link, one the teacher ran in a lesson (#147), or a video's tasks (#327). */
export const MISTAKE_SOURCES = ["homework", "game", "lesson_game", "video"] as const;
export type Mistake = { from: (typeof MISTAKE_SOURCES)[number]; title: string; at: Date; task: string; answer: string | null };
export type MistakesByTopic = { topic: string; count: number; mistakes: Mistake[] }[];

export const mistakesSince = (now: Date) => new Date(now.getTime() - MISTAKES_DAYS * DAY_MS);

/**
 * Groups mistakes by topic: the topic with the most first, then the one
 * with the latest mistake; inside a topic, newest first.
 */
export function groupByTopic(mistakes: (Mistake & { topic: string | null })[]): MistakesByTopic {
  const topics = new Map<string, Mistake[]>();
  for (const { topic, ...mistake } of mistakes) {
    const key = topic ?? NO_TOPIC;
    topics.set(key, [...(topics.get(key) ?? []), mistake]);
  }
  return [...topics]
    .map(([topic, list]) => ({ topic, count: list.length, mistakes: list.sort((a, b) => b.at.getTime() - a.at.getTime()) }))
    .sort((a, b) => b.count - a.count || b.mistakes[0]!.at.getTime() - a.mistakes[0]!.at.getTime());
}

function gameMistakes(results: CountedGameResult[]) {
  return results.flatMap((result) =>
    result.answers
      .filter((answer) => !answer.correct)
      .map((answer) => ({
        from: result.playedWithTeacher ? ("lesson_game" as const) : ("game" as const),
        topic: answer.topic ?? null,
        title: result.title,
        at: result.playedAt,
        task: answer.task,
        answer: answer.answer === "" ? null : answer.answer,
      })),
  );
}

/** The student's mistakes by topic over the last 30 days. */
export async function studentMistakes(
  db: Database,
  teacherId: string,
  studentId: string,
  now: Date = new Date(),
): Promise<MistakesByTopic> {
  const since = mistakesSince(now);
  const homework = (await homeworkMistakes(db, teacherId, studentId, since)).map((m) => ({ from: "homework" as const, ...m }));
  const games = await countedGameResults(db, teacherId, studentId, { since });
  const videos = (await videoMistakes(db, teacherId, studentId, since)).map((m) => ({ from: "video" as const, ...m }));
  return groupByTopic([...homework, ...gameMistakes(games), ...videos]);
}
