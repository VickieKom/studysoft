// The teacher's library (#115; product requirements, Library): games and
// warm-ups (#116), videos next. Every material belongs to one teacher; another
// teacher's material is the same as a missing one.
import { and, asc, desc, eq, isNotNull, or } from "drizzle-orm";
import { type AgeGroup, MAX_GAME_BYTES, MAX_PICTURE_BYTES, type MaterialKind } from "../../domain/library";
import type { Level } from "../../domain/student";
import { readBlob, saveBlob } from "../blob/store";
import type { Database } from "../db/client";
import { libraryMaterial } from "../db/schema";

export type MaterialTags = { title: string; level: Level; topic: string | null; ageGroup: AgeGroup };

export type Material = MaterialTags & {
  id: string;
  kind: MaterialKind;
  /** A questions warm-up's questions; null for every other material. */
  questions: string[] | null;
  /** A game the teacher also uses as a warm-up. */
  warmup: boolean;
  /** Whether a file is served for it: a game's page or a warm-up's picture. */
  hasFile: boolean;
  createdAt: Date;
};

const columns = {
  id: libraryMaterial.id,
  kind: libraryMaterial.kind,
  title: libraryMaterial.title,
  level: libraryMaterial.level,
  topic: libraryMaterial.topic,
  ageGroup: libraryMaterial.ageGroup,
  questions: libraryMaterial.questions,
  warmup: libraryMaterial.warmup,
  blobId: libraryMaterial.blobId,
  createdAt: libraryMaterial.createdAt,
};

const toMaterial = ({ blobId, ...row }: { [K in keyof typeof columns]: unknown }) =>
  ({ ...row, hasFile: blobId !== null }) as Material;

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

/** The type of a picture a warm-up may be, read from its first bytes, or null. */
export function pictureType(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

/** Saves a picture warm-up: the picture goes to the blob store first, then the row. */
export async function createPictureWarmup(
  db: Database,
  teacherId: string,
  tags: MaterialTags,
  picture: Uint8Array,
): Promise<{ id: string } | "too_big" | "not_picture"> {
  if (picture.byteLength > MAX_PICTURE_BYTES) return "too_big";
  const type = pictureType(picture);
  if (!type) return "not_picture";
  const blobId = await saveBlob(db, teacherId, picture, type);
  const [row] = await db
    .insert(libraryMaterial)
    .values({ teacherId, kind: "warmup", ...tags, blobId })
    .returning({ id: libraryMaterial.id });
  if (!row) throw new Error("createPictureWarmup: insert returned no row");
  return row;
}

/** Saves a questions warm-up; the questions are already checked by the caller. */
export async function createQuestionsWarmup(
  db: Database,
  teacherId: string,
  tags: MaterialTags,
  questions: string[],
): Promise<{ id: string }> {
  const [row] = await db
    .insert(libraryMaterial)
    .values({ teacherId, kind: "warmup", ...tags, questions })
    .returning({ id: libraryMaterial.id });
  if (!row) throw new Error("createQuestionsWarmup: insert returned no row");
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
        filter.kind === "warmup"
          ? // A game marked as a warm-up is listed under warm-ups too.
            or(eq(libraryMaterial.kind, "warmup"), and(eq(libraryMaterial.kind, "game"), eq(libraryMaterial.warmup, true)))
          : filter.kind
            ? eq(libraryMaterial.kind, filter.kind)
            : undefined,
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

/**
 * What an edit may change besides the tags: whether a game is also a
 * warm-up, and a questions warm-up's questions (#116).
 */
export type MaterialChanges = MaterialTags & { warmup?: boolean; questions?: string[] };

/**
 * Renames and retags a material of this teacher; false when there is none.
 * The warm-up mark is kept only on a game and the questions only on a
 * questions warm-up: the conditions are part of the write, so a change that
 * does not fit the material is not applied to it.
 */
export async function updateMaterial(db: Database, teacherId: string, id: string, changes: MaterialChanges): Promise<boolean> {
  const { warmup, questions, ...tags } = changes;
  const own = and(eq(libraryMaterial.id, id), eq(libraryMaterial.teacherId, teacherId));
  return db.transaction(async (tx) => {
    const rows = await tx.update(libraryMaterial).set(tags).where(own).returning({ id: libraryMaterial.id });
    if (rows.length === 0) return false;
    if (warmup !== undefined) {
      await tx.update(libraryMaterial).set({ warmup }).where(and(own, eq(libraryMaterial.kind, "game")));
    }
    if (questions !== undefined) {
      await tx
        .update(libraryMaterial)
        .set({ questions })
        .where(and(own, eq(libraryMaterial.kind, "warmup"), isNotNull(libraryMaterial.questions)));
    }
    return true;
  });
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
  if (!row?.blobId) return null;
  const file = await readBlob(db, teacherId, row.blobId);
  return file ? { blobId: row.blobId, ...file } : null;
}
