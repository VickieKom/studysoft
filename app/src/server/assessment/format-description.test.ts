import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ASSESSMENT_FORMAT_DESCRIPTION } from "./format-description";

describe("the assessment format description the assistant reads", () => {
  it("is docs/assessment-format.md word for word", () => {
    const document = readFileSync(join(__dirname, "../../../../docs/assessment-format.md"), "utf8");
    expect(ASSESSMENT_FORMAT_DESCRIPTION).toBe(document);
  });
});
