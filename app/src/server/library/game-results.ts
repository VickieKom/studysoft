// Game results (#119, docs/game-result-format.md): a game opened to a
// student posts the student's answers while they play it behind their link.
// A result is kept only while the game is open to this student; the latest
// result per game and lesson is the one that counts, the earlier ones stay.
import { sql } from "drizzle-orm";
import type { GameAnswer } from "../../domain/game-result-format";
import type { Database } from "../db/client";

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

export type CountedGameResult = { title: string; playedAt: Date; answers: GameAnswer[] };

/** The results that count since `since`, newest first: the latest of each game and lesson. */
export async function countedGameResults(
  db: Database,
  teacherId: string,
  studentId: string,
  since: Date,
): Promise<CountedGameResult[]> {
  const rows = await db.execute<{ title: string; created_at: string | Date; answers: GameAnswer[] }>(sql`
    SELECT * FROM (
      SELECT DISTINCT ON (material_id, lesson_id) title, created_at, answers
      FROM game_result
      WHERE teacher_id = ${teacherId} AND student_id = ${studentId}
      ORDER BY material_id, lesson_id, created_at DESC, id DESC
    ) AS latest
    WHERE created_at >= ${since.toISOString()}
    ORDER BY created_at DESC
  `);
  return [...rows].map((r) => ({ title: r.title, playedAt: new Date(r.created_at), answers: r.answers }));
}
