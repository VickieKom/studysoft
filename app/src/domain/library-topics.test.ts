import { describe, expect, it } from "vitest";
import { parseTopics, topicsText } from "./library";

// Topics typed into «Тема» (#290). The topics are synthetic.

describe("the topics typed into «Тема»", () => {
  it("are split at commas, trimmed, empty ones dropped, a repeat in another case kept once as first typed", () => {
    expect(parseTopics(" Present Simple ,food,, Food ,  еда  ,ЕДА")).toEqual(["Present Simple", "food", "еда"]);
    expect(parseTopics("")).toEqual([]);
    expect(parseTopics(" , ")).toEqual([]);
    expect(parseTopics("one  topic")).toEqual(["one topic"]);
  });

  it("are shown in the field separated by commas", () => {
    expect(topicsText(["Present Simple", "food"])).toBe("Present Simple, food");
    expect(parseTopics(topicsText(["a", "b"]))).toEqual(["a", "b"]);
  });
});
