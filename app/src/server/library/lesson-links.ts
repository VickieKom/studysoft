// A game linked to a lesson of the teacher's textbook (#291): the textbook
// and the lesson's id inside its confirmed structure. A lesson no longer in
// the structure is no link: the game stays, unlinked, wherever the link is
// read. Another teacher's textbook is the same as a missing one.
import { and, eq } from "drizzle-orm";
import { structureSchema } from "../../domain/textbook-structure";
import type { Database } from "../db/client";
import { libraryMaterial, textbook } from "../db/schema";

/** A lesson as the form, the filter and the page name it: «Unit 1 · 1.2». */
export const lessonLabel = (unit: string, lesson: string) => `${unit} · ${lesson}`;

export type LinkableTextbook = { id: string; title: string; lessons: { id: string; label: string }[] };

/** This teacher's textbooks with a confirmed structure, and their lessons in order. */
export async function linkableTextbooks(db: Pick<Database, "select">, teacherId: string): Promise<LinkableTextbook[]> {
  const rows = await db
    .select({ id: textbook.id, title: textbook.title, structure: textbook.structure })
    .from(textbook)
    .where(eq(textbook.teacherId, teacherId))
    .orderBy(textbook.title);
  return rows.flatMap((row) => {
    const parsed = structureSchema.safeParse(row.structure);
    if (!parsed.success) return [];
    const lessons = parsed.data.units.flatMap((u) => u.lessons.flatMap((l) => (l.id ? [{ id: l.id, label: lessonLabel(u.title, l.title) }] : [])));
    return [{ id: row.id, title: row.title, lessons }];
  });
}

/** A link as a page shows it, «Linked book · Unit 1 · 1.2», or null when the lesson is no longer there. */
export function linkLabel(textbooks: LinkableTextbook[], textbookId: string | null, lessonId: string | null): string | null {
  const book = textbookId ? textbooks.find((t) => t.id === textbookId) : undefined;
  const lesson = book?.lessons.find((l) => l.id === lessonId);
  return book && lesson ? `${book.title} · ${lesson.label}` : null;
}

/** Whether a link may be saved: the textbook is this teacher's and the lesson is in its confirmed structure. */
export async function checkLink(db: Pick<Database, "select">, teacherId: string, textbookId: string, lessonId: string): Promise<"ok" | "not_found" | "no_lesson"> {
  const book = (await linkableTextbooks(db, teacherId)).find((t) => t.id === textbookId);
  if (book) return book.lessons.some((l) => l.id === lessonId) ? "ok" : "no_lesson";
  // Hers without a confirmed structure has no lessons yet; another teacher's is a missing one.
  const [own] = await db.select({ id: textbook.id }).from(textbook).where(and(eq(textbook.id, textbookId), eq(textbook.teacherId, teacherId)));
  return own ? "no_lesson" : "not_found";
}

/** The games linked to each lesson of a textbook, drafts included, for the assistant (#291). */
export async function lessonGames(db: Pick<Database, "select">, teacherId: string, textbookId: string): Promise<Map<string, { id: string; title: string }[]>> {
  const rows = await db
    .select({ id: libraryMaterial.id, title: libraryMaterial.title, lessonId: libraryMaterial.textbookLessonId })
    .from(libraryMaterial)
    .where(and(eq(libraryMaterial.teacherId, teacherId), eq(libraryMaterial.textbookId, textbookId), eq(libraryMaterial.kind, "game")))
    .orderBy(libraryMaterial.title);
  const games = new Map<string, { id: string; title: string }[]>();
  for (const r of rows) if (r.lessonId) games.set(r.lessonId, [...(games.get(r.lessonId) ?? []), { id: r.id, title: r.title }]);
  return games;
}
