// The chalkboard on the lesson stage (#155, chalkboard brief 2026-11-19): a
// school board in the stage's right column. The teacher prints text in the
// chalk font (the main tool), writes in chalk by hand, wipes with a sponge,
// in four chalk colours, on sheets she pages through. «Очистить» empties a
// sheet without a question and «Вернуть» brings back what the last change
// took. The board is part of the lesson state; a lesson starts with a clean
// board of one sheet. Only text and strokes, no pictures, with limits that
// keep the document small. Plain data, zod and pure functions only.
import { z } from "zod";

/** The chalk colours, as the tool panel names them. */
export const CHALK_COLOURS = { white: "Белый мел", yellow: "Жёлтый мел", pink: "Розовый мел", blue: "Голубой мел" } as const;
export type ChalkColour = keyof typeof CHALK_COLOURS;
const colours = Object.keys(CHALK_COLOURS) as [ChalkColour, ...ChalkColour[]];

/** The sheet's own coordinates: a fixed width and height, scaled to the column. */
export const SHEET_WIDTH = 300;
export const SHEET_HEIGHT = 600;
export const MAX_SHEETS = 20;
export const MAX_ITEMS = 300;
export const MAX_POINTS = 400;
export const MAX_TEXT_LENGTH = 120;

const x = z.number().min(0).max(SHEET_WIDTH);
const y = z.number().min(0).max(SHEET_HEIGHT);

const item = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), x, y, text: z.string().trim().min(1).max(MAX_TEXT_LENGTH), colour: z.enum(colours) }).strict(),
  // Chalk by hand, or the sponge: a line the colour of the board, wider.
  z.object({ kind: z.literal("stroke"), points: z.array(z.tuple([x, y])).min(1).max(MAX_POINTS), colour: z.enum(colours) }).strict(),
  z.object({ kind: z.literal("sponge"), points: z.array(z.tuple([x, y])).min(1).max(MAX_POINTS) }).strict(),
]);
export type BoardItem = z.infer<typeof item>;

const items = z.array(item).max(MAX_ITEMS);
// What the last change on a sheet took, for «Вернуть»; null when there is nothing to bring back.
const sheet = z.object({ items, previous: items.nullable() }).strict();
export type Sheet = z.infer<typeof sheet>;

export const boardSchema = z
  .object({ sheets: z.array(sheet).min(1).max(MAX_SHEETS), current: z.number().int().min(0) })
  .strict()
  .refine((b) => b.current < b.sheets.length, { path: ["current"], message: "нет такого листа" });
export type Board = z.infer<typeof boardSchema>;

/** A clean board: one empty sheet. */
export function cleanBoard(): Board {
  return { sheets: [{ items: [], previous: null }], current: 0 };
}

function onSheet(board: Board, change: (sheet: Sheet) => Sheet): Board {
  return { ...board, sheets: board.sheets.map((s, i) => (i === board.current ? change(s) : s)) };
}

/** Adds text or a stroke to the current sheet; a full sheet takes nothing more. */
export function draw(board: Board, added: BoardItem): Board {
  return onSheet(board, (s) => (s.items.length >= MAX_ITEMS ? s : { items: [...s.items, added], previous: s.items }));
}

/** «Очистить»: the current sheet empty, at once; «Вернуть» brings it back. */
export function clearSheet(board: Board): Board {
  return onSheet(board, (s) => (s.items.length === 0 ? s : { items: [], previous: s.items }));
}

/** «Вернуть» (and Ctrl+Z): the current sheet as it was before its last change. */
export function undo(board: Board): Board {
  return onSheet(board, (s) => (s.previous === null ? s : { items: s.previous, previous: null }));
}

/** «Новый лист»: an empty sheet after the last one, made current; the earlier ones stay. */
export function newSheet(board: Board): Board {
  if (board.sheets.length >= MAX_SHEETS) return board;
  const sheets = [...board.sheets, { items: [], previous: null }];
  return { sheets, current: sheets.length - 1 };
}

/** ‹ and ›: the sheet before or after, never past the ends. */
export function turnSheet(board: Board, by: 1 | -1): Board {
  const current = Math.min(Math.max(board.current + by, 0), board.sheets.length - 1);
  return current === board.current ? board : { ...board, current };
}

/** «лист 2 из 3». */
export function sheetLabel(board: Board): string {
  return `лист ${board.current + 1} из ${board.sheets.length}`;
}


/** Every printed line of every sheet, in order, once each: what «Завершить урок» offers for the vocabulary (#206). */
export function printedLines(board: Board): string[] {
  const lines = board.sheets.flatMap((s) => s.items.flatMap((i) => (i.kind === "text" ? [i.text] : [])));
  return [...new Set(lines)];
}

/**
 * A printed line as a word of the vocabulary (#206): «word — translation»
 * splits at the first dash, equals sign or colon (a hyphen counts only with
 * spaces round it, so «ice-cream» stays whole); a line without one is a word
 * without a translation.
 */
export function lineToWord(line: string): { word: string; translation: string } {
  const at = /\s*(?:—|–|=|:|\s-\s)\s*/.exec(line);
  if (!at || at.index === 0) return { word: line.trim(), translation: "" };
  return { word: line.slice(0, at.index).trim(), translation: line.slice(at.index + at[0].length).trim() };
}
