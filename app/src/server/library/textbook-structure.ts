// A textbook's units and lessons (#150). The assistant saves a structure as
// a draft; the teacher saves her own edits as a draft and confirms. Only the
// confirmed structure is used by lessons. A draft and a confirmation are
// checked against the textbook: every page range within its book's rendered
// pages, every track one of the set's.
import { and, eq, sql } from "drizzle-orm";
import {
  type DraftAuthor,
  describeStructureIssue,
  structureSchema,
  type TextbookStructure,
} from "../../domain/textbook-structure";
import { BOOK_KINDS, BOOK_LABELS, type BookKind } from "../../domain/textbook";
import type { Database } from "../db/client";
import { textbook } from "../db/schema";
import { findTextbook } from "./textbooks";

type Found = NonNullable<Awaited<ReturnType<typeof findTextbook>>>;

/**
 * Validates a structure against the textbook and gives the lessons and
 * units their ids. Returns the structure, or the problems as lines the
 * teacher and the assistant read.
 */
export function checkStructure(found: Found, input: unknown): { ok: true; structure: TextbookStructure } | { ok: false; errors: string[] } {
  const parsed = structureSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.slice(0, 10).map(describeStructureIssue) };
  const errors: string[] = [];
  const pages = new Map(found.books.filter((b) => b.status === "done").map((b) => [b.kind, b.pageCount]));
  const tracks = new Set(found.tracks.map((t) => t.name));
  for (const [u, unit] of parsed.data.units.entries()) {
    for (const [l, lesson] of unit.lessons.entries()) {
      const where = `юнит ${u + 1}, урок ${l + 1}`;
      for (const kind of BOOK_KINDS) {
        const range = lesson.pages[kind];
        if (!range) continue;
        const count = pages.get(kind);
        if (count === undefined) errors.push(`${where}: ${BOOK_LABELS[kind]} нет в учебнике или её страницы ещё не готовы`);
        else if (range.to > count) errors.push(`${where}: в ${BOOK_LABELS[kind]} ${count} страниц, а урок доходит до ${range.to}`);
      }
      for (const track of lesson.tracks) if (!tracks.has(track)) errors.push(`${where}: трека «${track}» нет в учебнике`);
    }
  }
  if (errors.length > 0) return { ok: false, errors: errors.slice(0, 10) };
  const withIds: TextbookStructure = {
    units: parsed.data.units.map((unit) => ({
      ...unit,
      id: unit.id ?? crypto.randomUUID(),
      lessons: unit.lessons.map((lesson) => ({ ...lesson, id: lesson.id ?? crypto.randomUUID() })),
    })),
  };
  return { ok: true, structure: withIds };
}

/** The draft as the teacher's form loaded it: saving or confirming is refused when another draft replaced it meanwhile. */
const draftRevision = sql<string>`md5(coalesce(${textbook.structureDraft}::text, ''))`;

export type StructureView = {
  structure: TextbookStructure | null;
  /** Changes whenever the confirmed structure does. */
  structureRevision: string;
  draft: TextbookStructure | null;
  draftBy: DraftAuthor | null;
  revision: string;
};

/** A textbook's confirmed structure and its draft, or null when it is not this teacher's. */
export async function readStructure(db: Database, teacherId: string, textbookId: string): Promise<StructureView | null> {
  const [row] = await db
    .select({
      structure: textbook.structure,
      structureRevision: sql<string>`md5(coalesce(${textbook.structure}::text, ''))`,
      draft: textbook.structureDraft,
      draftBy: textbook.structureDraftBy,
      revision: draftRevision,
    })
    .from(textbook)
    .where(and(eq(textbook.id, textbookId), eq(textbook.teacherId, teacherId)));
  if (!row) return null;
  return {
    structure: (row.structure as TextbookStructure | null) ?? null,
    structureRevision: row.structureRevision,
    draft: (row.draft as TextbookStructure | null) ?? null,
    draftBy: (row.draftBy as DraftAuthor | null) ?? null,
    revision: row.revision,
  };
}

type Saved = "saved" | "not_found" | "conflict" | { errors: string[] };

/**
 * The assistant's draft. It replaces no draft but its own: once the teacher
 * has saved edits of her own, the assistant is refused until she confirms.
 */
export async function saveAssistantStructure(db: Database, teacherId: string, textbookId: string, input: unknown): Promise<Saved> {
  const found = await findTextbook(db, teacherId, textbookId);
  if (!found) return "not_found";
  const checked = checkStructure(found, input);
  if (!checked.ok) return { errors: checked.errors };
  const rows = await db
    .update(textbook)
    .set({ structureDraft: checked.structure, structureDraftBy: "assistant" })
    .where(
      and(
        eq(textbook.id, textbookId),
        eq(textbook.teacherId, teacherId),
        sql`coalesce(${textbook.structureDraftBy}, 'assistant') = 'assistant'`,
      ),
    )
    .returning({ id: textbook.id });
  return rows.length > 0 ? "saved" : "conflict";
}

/**
 * The teacher's edits: kept as her draft, or with `confirm` made the
 * structure lessons use, the draft cleared. Refused as a conflict when the
 * draft changed since her form loaded it (`revision`).
 */
export async function saveTeacherStructure(
  db: Database,
  teacherId: string,
  textbookId: string,
  input: unknown,
  revision: string,
  confirm: boolean,
): Promise<Saved> {
  const found = await findTextbook(db, teacherId, textbookId);
  if (!found) return "not_found";
  const checked = checkStructure(found, input);
  if (!checked.ok) return { errors: checked.errors };
  const rows = await db
    .update(textbook)
    .set(
      confirm
        ? { structure: checked.structure, structureDraft: null, structureDraftBy: null }
        : { structureDraft: checked.structure, structureDraftBy: "teacher" },
    )
    .where(and(eq(textbook.id, textbookId), eq(textbook.teacherId, teacherId), sql`${draftRevision} = ${revision}`))
    .returning({ id: textbook.id });
  return rows.length > 0 ? "saved" : "conflict";
}

/** One lesson of a textbook's confirmed structure, with its books' page ranges and its tracks, or null. */
export async function findLesson(db: Database, teacherId: string, textbookId: string, lessonId: string) {
  const found = await findTextbook(db, teacherId, textbookId);
  const view = found ? await readStructure(db, teacherId, textbookId) : null;
  if (!found || !view?.structure) return null;
  for (const unit of view.structure.units) {
    const lesson = unit.lessons.find((l) => l.id === lessonId);
    if (!lesson) continue;
    const tracks = lesson.tracks.flatMap((name) => found.tracks.filter((t) => t.name === name));
    const pages = found.books.flatMap((book) => {
      const range = lesson.pages[book.kind as BookKind];
      return range ? [{ fileId: book.id, kind: book.kind, from: range.from, to: range.to }] : [];
    });
    return { textbookTitle: found.title, unit: unit.title, title: lesson.title, pages, tracks, words: lesson.words };
  }
  return null;
}
