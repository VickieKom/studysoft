// Game result format (docs/game-result-format.md, #119): version 1, and
// version 2 (#285), whose answers may name the vocabulary word asked. A game
// in the library posts this message to the platform's window when the
// student finishes; the platform checks it and keeps the answers. Plain data
// and zod only, so the student's page and the server read it the same way.
import { z } from "zod";
import { SKILLS } from "./homework-format";

export const GAME_RESULT_TYPE = "studysoft.game-result";
/** The latest version, the one the assistant writes; every earlier one is still accepted. */
export const GAME_RESULT_FORMAT_VERSION = 2;
export const MAX_GAME_WORD_LENGTH = 200;
/** More than a game asks in one round; a longer list is not a result. */
export const MAX_GAME_ANSWERS = 100;
export const MAX_GAME_TEXT_LENGTH = 500;
export const MAX_GAME_TOPIC_LENGTH = 100;

const text = (max: number) => z.string().trim().min(1).max(max);

const answerFields = {
  task: text(MAX_GAME_TEXT_LENGTH),
  // An answer left blank is still an answer: an empty string.
  answer: z.string().trim().max(MAX_GAME_TEXT_LENGTH),
  correct: z.boolean(),
  topic: text(MAX_GAME_TOPIC_LENGTH).optional(),
  skill: z.enum(SKILLS).optional(),
};

const result = <A extends z.ZodType>(version: number, answer: A) =>
  z
    .object({ type: z.literal(GAME_RESULT_TYPE), version: z.literal(version), answers: z.array(answer).min(1).max(MAX_GAME_ANSWERS) })
    .strict();

export const gameResultSchema = z.union([
  result(1, z.object(answerFields).strict()),
  // Version 2 (#285): an answer may name the vocabulary word it asked, for a game template.
  result(2, z.object({ ...answerFields, word: text(MAX_GAME_WORD_LENGTH).optional() }).strict()),
]);

export type GameResult = z.infer<typeof gameResultSchema>;
export type GameAnswer = GameResult["answers"][number] & { word?: string };

/** Whether a message from a game's frame means to be a result; anything else a game posts is none of the platform's business. */
export function looksLikeGameResult(data: unknown): boolean {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === GAME_RESULT_TYPE;
}
