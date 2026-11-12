import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { note } from "../db/schema";

export type Note = { id: string; body: string; createdAt: Date };

const noteColumns = { id: note.id, body: note.body, createdAt: note.createdAt };

/** Notes on one student of this teacher, newest first. */
export async function listNotes(db: Database, teacherId: string, studentId: string): Promise<Note[]> {
  return db
    .select(noteColumns)
    .from(note)
    .where(and(eq(note.teacherId, teacherId), eq(note.studentId, studentId)))
    .orderBy(desc(note.createdAt), desc(note.id));
}

/** Adds a note; the caller has checked that the student is this teacher's. */
export async function addNote(db: Database, teacherId: string, studentId: string, body: string): Promise<Note> {
  const [row] = await db.insert(note).values({ teacherId, studentId, body }).returning(noteColumns);
  if (!row) throw new Error("addNote: insert returned no row");
  return row;
}

/** Changes a note of this teacher; null when there is no such note. */
export async function updateNote(db: Database, teacherId: string, id: string, body: string): Promise<Note | null> {
  const [row] = await db
    .update(note)
    .set({ body })
    .where(and(eq(note.id, id), eq(note.teacherId, teacherId)))
    .returning(noteColumns);
  return row ?? null;
}

/** Deletes a note of this teacher; false when there is no such note. */
export async function deleteNote(db: Database, teacherId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(note)
    .where(and(eq(note.id, id), eq(note.teacherId, teacherId)))
    .returning({ id: note.id });
  return rows.length > 0;
}
