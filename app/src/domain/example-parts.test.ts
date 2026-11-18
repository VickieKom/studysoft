import { describe, expect, it } from "vitest";
import { exampleParts } from "./homework";

describe("an example's parts (#131)", () => {
  it("puts the answer where the gap is", () => {
    expect(exampleParts({ text: "0 She ___ a teacher.", answer: "is" })).toEqual({ before: "0 She ", answer: "is", after: " a teacher." });
  });

  it("keeps a text without a gap whole, the answer after it, and a text without an answer as it is", () => {
    expect(exampleParts({ text: "0 dog — animal", answer: "b" })).toEqual({ before: "0 dog — animal", answer: "b", after: "" });
    expect(exampleParts({ text: "0 I like cats." })).toEqual({ before: "0 I like cats.", after: "" });
  });
});
