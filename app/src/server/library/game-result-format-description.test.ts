import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GAME_RESULT_FORMAT_DESCRIPTION } from "./game-result-format-description";

describe("the game result format description the assistant reads", () => {
  it("is docs/game-result-format.md word for word", () => {
    const document = readFileSync(join(__dirname, "../../../../docs/game-result-format.md"), "utf8");
    expect(GAME_RESULT_FORMAT_DESCRIPTION).toBe(document);
  });
});
