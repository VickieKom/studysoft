import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GAME_WORDS_FORMAT_DESCRIPTION } from "./game-words-format-description";

describe("the game words format description the assistant reads", () => {
  it("is docs/game-words-format.md word for word", () => {
    const document = readFileSync(join(__dirname, "../../../../docs/game-words-format.md"), "utf8");
    expect(GAME_WORDS_FORMAT_DESCRIPTION).toBe(document);
  });
});
