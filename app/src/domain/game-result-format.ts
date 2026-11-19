// Game result format, version 1 (docs/game-result-format.md, #119). A game
// in the library posts this message to the platform's window when the
// student finishes; the platform checks it and keeps the answers. Plain data
// and zod only, so the student's page and the server read it the same way.
import { z } from "zod";
import { SKILLS } from "./homework-format";

export const GAME_RESULT_TYPE = "studysoft.game-result";
export const GAME_RESULT_FORMAT_VERSION = 1;
/** More than a game asks in one round; a longer list is not a result. */
export const MAX_GAME_ANSWERS = 100;
export const MAX_GAME_TEXT_LENGTH = 500;
export const MAX_GAME_TOPIC_LENGTH = 100;

const text = (max: number) => z.string().trim().min(1).max(max);

export const gameResultSchema = z
  .object({
    type: z.literal(GAME_RESULT_TYPE),
    version: z.literal(GAME_RESULT_FORMAT_VERSION),
    answers: z
      .array(
        z
          .object({
            task: text(MAX_GAME_TEXT_LENGTH),
            // An answer left blank is still an answer: an empty string.
            answer: z.string().trim().max(MAX_GAME_TEXT_LENGTH),
            correct: z.boolean(),
            topic: text(MAX_GAME_TOPIC_LENGTH).optional(),
            skill: z.enum(SKILLS).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_GAME_ANSWERS),
  })
  .strict();

export type GameResult = z.infer<typeof gameResultSchema>;
export type GameAnswer = GameResult["answers"][number];

/** Whether a message from a game's frame means to be a result; anything else a game posts is none of the platform's business. */
export function looksLikeGameResult(data: unknown): boolean {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === GAME_RESULT_TYPE;
}
