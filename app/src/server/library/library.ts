// The teacher's library (#115; product requirements, Library): games and
// warm-ups (#116) and videos (#117). Every material belongs to one teacher;
// another teacher's material is the same as a missing one. The assistant saves
// games and warm-ups as drafts, which stay out of the library until the
// teacher adds them (#120; AGENTS.md, rule 5).
import { and, asc, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { type AgeGroup, MAX_GAME_BYTES, MAX_PICTURE_BYTES, MAX_URL_LENGTH, type MaterialKind } from "../../domain/library";
import type { Level } from "../../domain/student";
import { type BlobReader, openBlob, saveBlob } from "../blob/store";
import type { Database } from "../db/client";
import { blob, libraryMaterial } from "../db/schema";

export type MaterialTags = { title: string; level: Level; topic: string | null; ageGroup: AgeGroup };

export type Material = MaterialTags & {
  id: string;
  kind: MaterialKind;
  /** A questions warm-up's questions; null for every other material. */
  questions: string[] | null;
  /** A game the teacher also uses as a warm-up. */
  warmup: boolean;
  /** A video link's address; null for every other material. */
  url: string | null;
  /** Whether a file is served for it: a game's page, a warm-up's picture or an own video. */
  hasFile: boolean;
  /** Saved by the assistant and not yet added to the library (#120). */
  draft: boolean;
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
  url: libraryMaterial.url,
  draft: libraryMaterial.draft,
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

/** Checks a game's HTML and stores it: the file's id, or why it is refused. Used for uploads and the assistant's drafts. */
export async function storeGame(db: Database, teacherId: string, html: Uint8Array): Promise<string | "too_big" | "not_html"> {
  if (html.byteLength > MAX_GAME_BYTES) return "too_big";
  if (!looksLikeHtml(html)) return "not_html";
  return saveBlob(db, teacherId, html, "text/html; charset=utf-8");
}

/** Saves a game: the HTML goes to the blob store first, then the row that refers to it. */
export async function createGame(
  db: Database,
  teacherId: string,
  tags: MaterialTags,
  html: Uint8Array,
): Promise<{ id: string } | "too_big" | "not_html"> {
  const blobId = await storeGame(db, teacherId, html);
  if (blobId === "too_big" || blobId === "not_html") return blobId;
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

/** Checks a warm-up's picture and stores it: the file's id, or why it is refused. Used for uploads and the assistant's drafts. */
export async function storePicture(db: Database, teacherId: string, picture: Uint8Array): Promise<string | "too_big" | "not_picture"> {
  if (picture.byteLength > MAX_PICTURE_BYTES) return "too_big";
  const type = pictureType(picture);
  if (!type) return "not_picture";
  return saveBlob(db, teacherId, picture, type);
}

/** Saves a picture warm-up: the picture goes to the blob store first, then the row. */
export async function createPictureWarmup(
  db: Database,
  teacherId: string,
  tags: MaterialTags,
  picture: Uint8Array,
): Promise<{ id: string } | "too_big" | "not_picture"> {
  const blobId = await storePicture(db, teacherId, picture);
  if (blobId === "too_big" || blobId === "not_picture") return blobId;
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

/**
 * The type of a video file a browser plays, from its first bytes (#117): MP4
 * and MOV are ISO boxes (MOV may also start with an old QuickTime atom),
 * WebM is Matroska that names itself "webm". Anything else — FLV, AVI, MKV,
 * an MP4 that holds only sound or a photo — is refused.
 */
export function sniffVideo(head: Uint8Array): string | null {
  const ascii = (offset: number, length: number) => String.fromCharCode(...head.slice(offset, offset + length));
  const box = ascii(4, 4);
  if (box === "ftyp") {
    const brand = ascii(8, 4);
    if (brand === "qt  ") return "video/quicktime";
    // Sound alone (M4A and audiobooks) and HEIF or AVIF pictures are ISO boxes too.
    if (["M4A ", "M4B ", "M4P ", "heic", "heix", "hevc", "heim", "heis", "mif1", "msf1", "avif", "avis"].includes(brand)) {
      return null;
    }
    return "video/mp4";
  }
  if (["moov", "mdat", "wide"].includes(box)) return "video/quicktime";
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    // The EBML header names the document type; a browser plays WebM, not every Matroska file.
    return ascii(0, head.byteLength).includes("webm") ? "video/webm" : null;
  }
  return null;
}

/** Whether a text is a link a video can be: http or https, with a host. */
export function isVideoLink(text: string): boolean {
  if (text.length > MAX_URL_LENGTH) return false;
  try {
    const url = new URL(text);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
  } catch {
    return false;
  }
}

/** Saves a video link; the address is checked here, since the page renders it as a link. */
export async function createVideoLink(
  db: Database,
  teacherId: string,
  tags: MaterialTags,
  url: string,
): Promise<{ id: string } | "not_a_link"> {
  if (!isVideoLink(url)) return "not_a_link";
  const [row] = await db
    .insert(libraryMaterial)
    .values({ teacherId, kind: "video", ...tags, url })
    .returning({ id: libraryMaterial.id });
  if (!row) throw new Error("createVideoLink: insert returned no row");
  return row;
}

/**
 * Saves an own video whose file was uploaded first (#117). The file must be
 * this teacher's and a video: a stored file's owner and type never change, so
 * reading them before the insert is safe, and the foreign key keeps the file
 * from going while the row refers to it.
 */
export async function createVideoFile(
  db: Database,
  teacherId: string,
  tags: MaterialTags,
  blobId: string,
): Promise<{ id: string } | "no_file"> {
  const [file] = await db.select({ teacherId: blob.teacherId, contentType: blob.contentType }).from(blob).where(eq(blob.id, blobId));
  if (!file || file.teacherId !== teacherId || !file.contentType.startsWith("video/")) return "no_file";
  const [row] = await db
    .insert(libraryMaterial)
    .values({ teacherId, kind: "video", ...tags, blobId })
    .returning({ id: libraryMaterial.id });
  if (!row) throw new Error("createVideoFile: insert returned no row");
  return row;
}

export type MaterialFilter = { kind?: MaterialKind; level?: Level; topic?: string; ageGroup?: AgeGroup };

/** This teacher's materials in the library matching the filter, newest first; drafts are not in it. */
export async function listMaterials(db: Database, teacherId: string, filter: MaterialFilter): Promise<Material[]> {
  const rows = await db
    .select(columns)
    .from(libraryMaterial)
    .where(
      and(
        eq(libraryMaterial.teacherId, teacherId),
        eq(libraryMaterial.draft, false),
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
    .where(and(eq(libraryMaterial.teacherId, teacherId), eq(libraryMaterial.draft, false), isNotNull(libraryMaterial.topic)))
    .orderBy(asc(libraryMaterial.topic));
  return rows.map((r) => r.topic).filter((t): t is string => t !== null);
}

/** The assistant's drafts of this teacher, newest first: «От ассистента» above the library (#120). */
export async function listDrafts(db: Database, teacherId: string): Promise<Material[]> {
  const rows = await db
    .select(columns)
    .from(libraryMaterial)
    .where(and(eq(libraryMaterial.teacherId, teacherId), eq(libraryMaterial.draft, true)))
    .orderBy(desc(libraryMaterial.createdAt));
  return rows.map(toMaterial);
}

/** What the assistant saves: a game's file, a picture warm-up's picture, or a questions warm-up's questions. */
export type DraftContent =
  | { kind: "game"; blobId: string }
  | { kind: "warmup"; blobId: string }
  | { kind: "warmup"; questions: string[] };

/**
 * Saves the assistant's draft (#120). With `replace`, the draft with that id
 * is replaced if it is this teacher's, still a draft, of the same kind and
 * not edited by her: the conditions are part of the write, so an edit or
 * «Добавить в библиотеку» committed meanwhile wins and a new draft is made
 * instead. Returns the id of the draft written.
 */
export async function saveDraft(
  db: Database,
  teacherId: string,
  tags: MaterialTags,
  content: DraftContent,
  replace?: string,
): Promise<string> {
  const values = {
    ...tags,
    blobId: "blobId" in content ? content.blobId : null,
    questions: "questions" in content ? content.questions : null,
  };
  if (replace) {
    const [replaced] = await db
      .update(libraryMaterial)
      .set(values)
      .where(
        and(
          eq(libraryMaterial.id, replace),
          eq(libraryMaterial.teacherId, teacherId),
          eq(libraryMaterial.kind, content.kind),
          eq(libraryMaterial.draft, true),
          isNull(libraryMaterial.teacherEditedAt),
        ),
      )
      .returning({ id: libraryMaterial.id });
    if (replaced) return replaced.id;
  }
  const [row] = await db
    .insert(libraryMaterial)
    .values({ teacherId, kind: content.kind, ...values, draft: true })
    .returning({ id: libraryMaterial.id });
  if (!row) throw new Error("saveDraft: insert returned no row");
  return row.id;
}

/** «Добавить в библиотеку» (#120): a draft of this teacher becomes a regular material. False when there is no such material. */
export async function addToLibrary(db: Database, teacherId: string, id: string): Promise<boolean> {
  const rows = await db
    .update(libraryMaterial)
    .set({ draft: false })
    .where(and(eq(libraryMaterial.id, id), eq(libraryMaterial.teacherId, teacherId)))
    .returning({ id: libraryMaterial.id });
  return rows.length === 1;
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
    // Her edit of a draft keeps the assistant from replacing it (#120).
    const edited = { teacherEditedAt: sql`CASE WHEN ${libraryMaterial.draft} THEN now() ELSE ${libraryMaterial.teacherEditedAt} END` };
    const rows = await tx.update(libraryMaterial).set({ ...tags, ...edited }).where(own).returning({ id: libraryMaterial.id });
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

/** The file of a material of this teacher, open for reading in pieces, or null — a video link has none. */
export async function materialFile(
  db: Database,
  teacherId: string,
  id: string,
): Promise<{ blobId: string; reader: BlobReader; contentType: string } | null> {
  const [row] = await db
    .select({ blobId: libraryMaterial.blobId })
    .from(libraryMaterial)
    .where(and(eq(libraryMaterial.id, id), eq(libraryMaterial.teacherId, teacherId)));
  if (!row?.blobId) return null;
  const file = await openBlob(db, teacherId, row.blobId);
  return file ? { blobId: row.blobId, ...file } : null;
}
