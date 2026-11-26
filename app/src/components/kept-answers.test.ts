import { describe, expect, it } from "vitest";
import { type KeptAnswers, keptOnOpen, RELOAD_WINDOW_MS } from "./kept-answers";

// The answers kept in the browser when the assessment opens (#399, #412).

const now = 1_000_000_000;

describe("answers kept in the browser, when the page opens", () => {
  it("sends again an answer the server never confirmed, whatever the page has", () => {
    const kept: KeptAnswers = { "reading:0": { skill: "reading", index: 0, value: "1" } };
    expect(keptOnOpen(kept, {}, now)).toEqual(kept);
    expect(keptOnOpen(kept, { reading: ["1"] }, now)).toEqual(kept);
  });

  it("drops a confirmed answer the page already has", () => {
    const kept: KeptAnswers = { "reading:0": { skill: "reading", index: 0, value: "1", savedAt: now - 1_000 } };
    expect(keptOnOpen(kept, { reading: ["1"] }, now)).toEqual({});
  });

  it("sends again a confirmed answer saved moments ago that the page does not have: it was rendered before the save", () => {
    const kept: KeptAnswers = { "reading:0": { skill: "reading", index: 0, value: "1", savedAt: now - 1_000 } };
    expect(keptOnOpen(kept, { reading: ["0"] }, now)).toEqual(kept);
    expect(keptOnOpen(kept, {}, now)).toEqual(kept);
  });

  it("drops a confirmed answer older than the reload window, even when the server has another value: it was changed since", () => {
    const kept: KeptAnswers = { "reading:0": { skill: "reading", index: 0, value: "1", savedAt: now - RELOAD_WINDOW_MS } };
    expect(keptOnOpen(kept, { reading: ["2"] }, now)).toEqual({});
  });

  it("decides for each answer on its own", () => {
    const kept: KeptAnswers = {
      "reading:0": { skill: "reading", index: 0, value: "1", savedAt: now - 2 * RELOAD_WINDOW_MS },
      "grammar:0": { skill: "grammar", index: 0, value: "walked" },
      "writing:0": { skill: "writing", index: 0, value: "Dear Pim", savedAt: now - 500 },
    };
    expect(keptOnOpen(kept, { reading: ["2"], writing: [null] }, now)).toEqual({
      "grammar:0": kept["grammar:0"],
      "writing:0": kept["writing:0"],
    });
  });
});
