import { describe, expect, it } from "vitest";
import { measureField, measureLabel } from "./student";

describe("the personal measure on the card (#266)", () => {
  it("shows first → last, one number alone, nothing without numbers", () => {
    expect(measureLabel("на английском", "мин", [5, 8, 12])).toBe("на английском: 5 → 12 мин");
    expect(measureLabel("на английском", "мин", [12])).toBe("на английском: 12 мин");
    expect(measureLabel("книги", null, [1, 3])).toBe("книги: 1 → 3");
    expect(measureLabel("на английском", "мин", [])).toBeNull();
    expect(measureLabel("на английском", "мин", [7.5, 10])).toBe("на английском: 7,5 → 10 мин");
  });

  it("labels the number when a lesson is marked", () => {
    expect(measureField("на английском", "мин")).toBe("на английском, мин");
    expect(measureField("книги", null)).toBe("книги");
  });
});
