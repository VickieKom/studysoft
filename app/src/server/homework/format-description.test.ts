import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HOMEWORK_FORMAT_DESCRIPTION } from "./format-description";

describe("the format description the assistant reads", () => {
  it("is docs/homework-format.md word for word", () => {
    const document = readFileSync(join(__dirname, "../../../../docs/homework-format.md"), "utf8");
    expect(HOMEWORK_FORMAT_DESCRIPTION).toBe(document);
  });
});
