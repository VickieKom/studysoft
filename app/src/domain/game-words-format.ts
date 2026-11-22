// The words format (#282): the message the platform posts to a game template
// in its frame, with a student's words. docs/game-words-format.md describes it
// for whoever writes a game, the assistant included. Plain data only.
import { z } from "zod";

export const GAME_WORDS_TYPE = "studysoft.words";
export const GAME_WORDS_REQUEST_TYPE = "studysoft.words-request";
export const GAME_WORDS_VERSION = 1;
/** The most words one message carries, the newest first. */
export const MAX_GAME_WORDS = 300;

export type GameWord = { word: string; translation: string; example?: string };
export type GameWordsMessage = { type: typeof GAME_WORDS_TYPE; version: typeof GAME_WORDS_VERSION; words: GameWord[] };

export const gameWordsMessage = (words: GameWord[]): GameWordsMessage => ({ type: GAME_WORDS_TYPE, version: GAME_WORDS_VERSION, words });

/** A game asks for the words again, for one that sets up its listener late. */
export function isWordsRequest(data: unknown): boolean {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === GAME_WORDS_REQUEST_TYPE;
}

/** What a procedure returns: the words of the message. */
export const gameWordsOutput = z
  .object({ words: z.array(z.object({ word: z.string(), translation: z.string(), example: z.string().optional() }).strict()) })
  .strict();
