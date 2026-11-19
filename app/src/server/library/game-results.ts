// Game results (#119, docs/game-result-format.md): a game opened to a
// student posts the student's answers while they play it behind their link.
// A result is kept only while the game is open to this student; the latest
// result per game and lesson is the one that counts, the earlier ones stay.
// A game the teacher runs herself during a lesson keeps its result for the
// student of that lesson (#147).
import { sql } from "drizzle-orm";
import type { GameAnswer } from "../../domain/game-result-format";
import type { Database } from "../db/client";
import { LIVE_LESSON } from "./student-games";

/**
 * Keeps a result for this student's open game. One statement reads the
 * access and writes the result, so a game not open to this student, one
 * whose access has ended or another teacher's never get one, even if the
 * access ends between a check and the write. Returns whether it was kept.
 */
export async function saveGameResult(
  db: Database,
  teacherId: string,
  studentId: string,
  materialId: string,
  answers: GameAnswer[],
  now: Date = new Date(),
): Promise<boolean> {
  const rows = await db.execute<{ id: string }>(sql`
    INSERT INTO game_result (teacher_id, student_id, material_id, lesson_id, title, answers)
    SELECT a.teacher_id, a.student_id, a.material_id, a.lesson_id, m.title, ${JSON.stringify(answers)}::jsonb
    FROM game_access AS a
    JOIN library_material AS m ON m.id = a.material_id AND m.teacher_id = a.teacher_id
    WHERE a.teacher_id = ${teacherId}
      AND a.student_id = ${studentId}
      AND a.material_id = ${materialId}
      AND a.until > ${now.toISOString()}
    RETURNING id
  `);
  return [...rows].length === 1;
}

/**
 * Keeps a result of this teacher's game, played on her page, for a student
 * of hers whose lesson is going on at `now` (#147). One statement reads the
 * lesson, the student and the game and writes the result, so a lesson not
 * going on (cancelled and missed ones included), another teacher's game or
 * student, or a video never get one. Returns whether it was kept.
 */
export async function saveLessonGameResult(
  db: Database,
  teacherId: string,
  materialId: string,
  studentId: string,
  answers: GameAnswer[],
  now: Date = new Date(),
): Promise<boolean> {
  const rows = await db.execute<{ id: string }>(sql`
    INSERT INTO game_result (teacher_id, student_id, material_id, lesson_id, title, answers, played_with_teacher)
    SELECT l.teacher_id, l.student_id, m.id, l.id, m.title, ${JSON.stringify(answers)}::jsonb, true
    FROM lesson AS l
    JOIN student AS s ON s.id = l.student_id AND s.teacher_id = l.teacher_id AND s.deleted_at IS NULL
    JOIN library_material AS m ON m.id = ${materialId} AND m.teacher_id = l.teacher_id AND m.kind = 'game'
    WHERE l.teacher_id = ${teacherId}
      AND l.student_id = ${studentId}
      AND ${LIVE_LESSON}
      AND l.starts_at <= ${now.toISOString()}
      AND l.starts_at + l.duration_minutes * interval '1 minute' > ${now.toISOString()}
    ORDER BY l.starts_at DESC
    LIMIT 1
    RETURNING id
  `);
  return [...rows].length === 1;
}

export type CountedGameResult = { title: string; playedAt: Date; playedWithTeacher: boolean; answers: GameAnswer[] };

/**
 * The results that count, newest first: the latest of each game and lesson;
 * only those since `since`, and at most `limit`, when given.
 */
export async function countedGameResults(
  db: Database,
  teacherId: string,
  studentId: string,
  { since, limit }: { since?: Date; limit?: number },
): Promise<CountedGameResult[]> {
  const rows = await db.execute<{ title: string; created_at: string | Date; played_with_teacher: boolean; answers: GameAnswer[] }>(sql`
    SELECT * FROM (
      SELECT DISTINCT ON (material_id, lesson_id) title, created_at, played_with_teacher, answers
      FROM game_result
      WHERE teacher_id = ${teacherId} AND student_id = ${studentId}
      ORDER BY material_id, lesson_id, created_at DESC, id DESC
    ) AS latest
    WHERE ${since ? sql`created_at >= ${since.toISOString()}` : sql`true`}
    ORDER BY created_at DESC
    ${limit ? sql`LIMIT ${limit}` : sql``}
  `);
  return [...rows].map((r) => ({
    title: r.title,
    playedAt: new Date(r.created_at),
    playedWithTeacher: r.played_with_teacher,
    answers: r.answers,
  }));
}
