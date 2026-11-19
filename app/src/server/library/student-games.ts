// Games opened to a student (#118; library brief): while one of the
// student's lessons is going on, the teacher opens a game to them; the
// student plays it behind their link until an hour after that lesson's end.
// Only "is a lesson going on now" is read from the schedule. A student sees
// only their own open games; anything else is the same as a missing game.
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { GAME_ACCESS_AFTER_LESSON_MS } from "../../domain/library";
import type { Database } from "../db/client";
import { gameAccess, libraryMaterial, student } from "../db/schema";

/** Lessons that count: a cancelled or missed one is not going on. */
export const LIVE_LESSON = sql`l.status NOT IN ('cancelled', 'missed')`;

const nameOf = (firstName: string, lastName: string | null) => (lastName ? `${firstName} ${lastName}` : firstName);

/** This teacher's students with a lesson going on at `now`, by name. */
export async function studentsInLesson(
  db: Database,
  teacherId: string,
  now: Date = new Date(),
): Promise<{ studentId: string; name: string }[]> {
  const rows = await db.execute<{ id: string; first_name: string; last_name: string | null }>(sql`
    SELECT DISTINCT s.id, s.first_name, s.last_name
    FROM lesson AS l
    JOIN student AS s ON s.id = l.student_id AND s.teacher_id = l.teacher_id AND s.deleted_at IS NULL
    WHERE l.teacher_id = ${teacherId}
      AND ${LIVE_LESSON}
      AND l.starts_at <= ${now.toISOString()}
      AND l.starts_at + l.duration_minutes * interval '1 minute' > ${now.toISOString()}
    ORDER BY s.first_name, s.last_name
  `);
  return [...rows].map((r) => ({ studentId: r.id, name: nameOf(r.first_name, r.last_name) }));
}

/**
 * Opens this teacher's game to her student while a lesson of theirs is going
 * on, until an hour after that lesson's end; opened again in a later lesson,
 * the access moves on, never back. One statement checks the lesson, the game
 * and the student and writes the access, so a lesson that is not going on, a
 * video, the assistant's draft (#120) or another teacher's game or student
 * never get one. Returns when the
 * access ends, or null when nothing was opened.
 */
export async function openGameToStudent(
  db: Database,
  teacherId: string,
  materialId: string,
  studentId: string,
  now: Date = new Date(),
): Promise<Date | null> {
  const after = `${GAME_ACCESS_AFTER_LESSON_MS / 1000} seconds`;
  const rows = await db.execute<{ until: string | Date }>(sql`
    INSERT INTO game_access (teacher_id, student_id, material_id, lesson_id, until)
    SELECT l.teacher_id, l.student_id, m.id, l.id,
           l.starts_at + l.duration_minutes * interval '1 minute' + ${after}::interval
    FROM lesson AS l
    JOIN student AS s ON s.id = l.student_id AND s.teacher_id = l.teacher_id AND s.deleted_at IS NULL
    JOIN library_material AS m ON m.id = ${materialId} AND m.teacher_id = l.teacher_id AND m.kind = 'game' AND NOT m.draft
    WHERE l.teacher_id = ${teacherId}
      AND l.student_id = ${studentId}
      AND ${LIVE_LESSON}
      AND l.starts_at <= ${now.toISOString()}
      AND l.starts_at + l.duration_minutes * interval '1 minute' > ${now.toISOString()}
    ORDER BY l.starts_at DESC
    LIMIT 1
    ON CONFLICT (material_id, student_id) DO UPDATE
      -- The lesson that gives the latest end stays the access's lesson, so
      -- removing a shorter later lesson does not take a longer access with it.
      SET lesson_id = CASE WHEN EXCLUDED.until > game_access.until THEN EXCLUDED.lesson_id ELSE game_access.lesson_id END,
          until = GREATEST(game_access.until, EXCLUDED.until),
          updated_at = now()
    RETURNING until
  `);
  const [row] = [...rows];
  return row ? new Date(row.until) : null;
}

/** Whom this teacher's game is open to at `now`, and until when. */
export async function gameOpenedTo(
  db: Database,
  teacherId: string,
  materialId: string,
  now: Date = new Date(),
): Promise<{ studentId: string; name: string; until: Date }[]> {
  const rows = await db
    .select({ studentId: student.id, firstName: student.firstName, lastName: student.lastName, until: gameAccess.until })
    .from(gameAccess)
    .innerJoin(student, and(eq(student.id, gameAccess.studentId), isNull(student.deletedAt)))
    .where(and(eq(gameAccess.teacherId, teacherId), eq(gameAccess.materialId, materialId), gt(gameAccess.until, now)))
    .orderBy(asc(student.firstName));
  return rows.map((r) => ({ studentId: r.studentId, name: nameOf(r.firstName, r.lastName), until: r.until }));
}

/** The games open to this student at `now`, by title. */
export async function studentGames(
  db: Database,
  teacherId: string,
  studentId: string,
  now: Date = new Date(),
): Promise<{ id: string; title: string }[]> {
  return db
    .select({ id: libraryMaterial.id, title: libraryMaterial.title })
    .from(gameAccess)
    .innerJoin(libraryMaterial, and(eq(libraryMaterial.id, gameAccess.materialId), eq(libraryMaterial.teacherId, teacherId)))
    .where(and(eq(gameAccess.teacherId, teacherId), eq(gameAccess.studentId, studentId), gt(gameAccess.until, now)))
    .orderBy(asc(libraryMaterial.title));
}

/** One game open to this student at `now`, or null: missing, not opened, closed and another's are the same. */
export async function studentGame(
  db: Database,
  teacherId: string,
  studentId: string,
  id: string,
  now: Date = new Date(),
): Promise<{ id: string; title: string } | null> {
  const [row] = await db
    .select({ id: libraryMaterial.id, title: libraryMaterial.title })
    .from(gameAccess)
    .innerJoin(libraryMaterial, and(eq(libraryMaterial.id, gameAccess.materialId), eq(libraryMaterial.teacherId, teacherId)))
    .where(
      and(
        eq(gameAccess.teacherId, teacherId),
        eq(gameAccess.studentId, studentId),
        eq(gameAccess.materialId, id),
        gt(gameAccess.until, now),
      ),
    );
  return row ?? null;
}
