import { describe, expect, it } from "vitest";
import { likedLabel } from "./library";

// «нравится N детям» in the library (#334).

describe("the liked label", () => {
  it("is nothing for none, «ребёнку» after one, «детям» otherwise", () => {
    expect(likedLabel(0)).toBeNull();
    expect(likedLabel(1)).toBe("нравится 1 ребёнку");
    expect(likedLabel(2)).toBe("нравится 2 детям");
    expect(likedLabel(5)).toBe("нравится 5 детям");
    expect(likedLabel(11)).toBe("нравится 11 детям");
    expect(likedLabel(21)).toBe("нравится 21 ребёнку");
  });
});
