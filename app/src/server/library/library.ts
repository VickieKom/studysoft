// The teacher's library (#115; product requirements, Library): games now,
// warm-ups and videos next. Every material belongs to one teacher; another
// teacher's material is the same as a missing one.
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { type AgeGroup, MAX_GAME_BYTES, type MaterialKind } from "../../domain/library";
import type { Level } from "../../domain/student";
import { readBlob, saveBlob } from "../blob/store";
import type { Database } from "../db/client";
import { libraryMaterial } from "../db/schema";

export type MaterialTags = { title: string; level: Level; topic: string | null; ageGroup: AgeGroup };

export type Material = MaterialTags & { id: string; kind: MaterialKind; createdAt: Date };

const columns = {
  id: libraryMaterial.id,
  kind: libraryMaterial.kind,
  title: libraryMaterial.title,
  level: libraryMaterial.level,
  topic: libraryMaterial.topic,
  ageGroup: libraryMaterial.ageGroup,
  createdAt: libraryMaterial.createdAt,
};

const toMaterial = (row: { [K in keyof typeof columns]: unknown }) => row as Material;

/**
 * Whether these bytes are a web page a game can be: UTF-8 text that starts
 * like HTML. Anything else — a PDF, a picture, a script alone — is not.
 */
export function looksLikeHtml(bytes: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, 4096));
  } catch {
    return false;
  }
  return /^\s*(﻿)?\s*(<!--[\s\S]*?-->\s*)*<(!doctype\s+html|html|head|body)\b/i.test(text);
}

/** Saves a game: the HTML goes to the blob store first, then the row that refers to it. */
export async function createGame(
  db: Database,
  teacherId: string,
  tags: MaterialTags,
  html: Uint8Array,
): Promise<{ id: string } | "too_big" | "not_html"> {
  if (html.byteLength > MAX_GAME_BYTES) return "too_big";
  if (!looksLikeHtml(html)) return "not_html";
  const blobId = await saveBlob(db, teacherId, html, "text/html; charset=utf-8");
  const [row] = await db
    .insert(libraryMaterial)
    .values({ teacherId, kind: "game", ...tags, blobId })
    .returning({ id: libraryMaterial.id });
  if (!row) throw new Error("createGame: insert returned no row");
  return row;
}

export type MaterialFilter = { kind?: MaterialKind; level?: Level; topic?: string; ageGroup?: AgeGroup };

/** This teacher's materials matching the filter, newest first. */
export async function listMaterials(db: Database, teacherId: string, filter: MaterialFilter): Promise<Material[]> {
  const rows = await db
    .select(columns)
    .from(libraryMaterial)
    .where(
      and(
        eq(libraryMaterial.teacherId, teacherId),
        filter.kind ? eq(libraryMaterial.kind, filter.kind) : undefined,
        filter.level ? eq(libraryMaterial.level, filter.level) : undefined,
        filter.topic ? eq(libraryMaterial.topic, filter.topic) : undefined,
        filter.ageGroup ? eq(libraryMaterial.ageGroup, filter.ageGroup) : undefined,
      ),
    )
    .orderBy(desc(libraryMaterial.createdAt));
  return rows.map(toMaterial);
}

/** The topics this teacher's materials use, for the topic filter. */
export async function materialTopics(db: Database, teacherId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ topic: libraryMaterial.topic })
    .from(libraryMaterial)
    .where(and(eq(libraryMaterial.teacherId, teacherId), isNotNull(libraryMaterial.topic)))
    .orderBy(asc(libraryMaterial.topic));
  return rows.map((r) => r.topic).filter((t): t is string => t !== null);
}

/** One material of this teacher, or null. */
export async function findMaterial(db: Database, teacherId: string, id: string): Promise<Material | null> {
  const [row] = await db
    .select(columns)
    .from(libraryMaterial)
    .where(and(eq(libraryMaterial.id, id), eq(libraryMaterial.teacherId, teacherId)));
  return row ? toMaterial(row) : null;
}

/** Renames and retags a material of this teacher; false when there is none. */
export async function updateMaterial(db: Database, teacherId: string, id: string, tags: MaterialTags): Promise<boolean> {
  const rows = await db
    .update(libraryMaterial)
    .set(tags)
    .where(and(eq(libraryMaterial.id, id), eq(libraryMaterial.teacherId, teacherId)))
    .returning({ id: libraryMaterial.id });
  return rows.length > 0;
}

/**
 * Removes a material of this teacher; false when there is none. Its file
 * stops being served at once; the stored file goes with the cleanup of files
 * nothing refers to (#73).
 */
export async function deleteMaterial(db: Database, teacherId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(libraryMaterial)
    .where(and(eq(libraryMaterial.id, id), eq(libraryMaterial.teacherId, teacherId)))
    .returning({ id: libraryMaterial.id });
  return rows.length > 0;
}

/** The file of a material of this teacher, or null. */
export async function materialFile(
  db: Database,
  teacherId: string,
  id: string,
): Promise<{ blobId: string; bytes: Uint8Array; contentType: string } | null> {
  const [row] = await db
    .select({ blobId: libraryMaterial.blobId })
    .from(libraryMaterial)
    .where(and(eq(libraryMaterial.id, id), eq(libraryMaterial.teacherId, teacherId)));
  if (!row) return null;
  const file = await readBlob(db, teacherId, row.blobId);
  return file ? { blobId: row.blobId, ...file } : null;
}
