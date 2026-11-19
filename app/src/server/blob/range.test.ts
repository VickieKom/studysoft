import { describe, expect, it } from "vitest";
import { byteRange } from "./range";

describe("byteRange", () => {
  it("reads a start and an end, an open end and a suffix, and clips the end to the file", () => {
    expect(byteRange("bytes=0-1", 10)).toEqual({ start: 0, end: 1 });
    expect(byteRange("bytes=4-", 10)).toEqual({ start: 4, end: 9 });
    expect(byteRange("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
    expect(byteRange("bytes=-30", 10)).toEqual({ start: 0, end: 9 });
    expect(byteRange("bytes=8-100", 10)).toEqual({ start: 8, end: 9 });
  });

  it("answers unsatisfiable past the end or backwards, and nothing to honour when there is no single range", () => {
    expect(byteRange("bytes=10-", 10)).toBe("unsatisfiable");
    expect(byteRange("bytes=5-4", 10)).toBe("unsatisfiable");
    expect(byteRange("bytes=0-0", 0)).toBe("unsatisfiable");
    for (const header of [null, "", "bytes=-", "bytes=0-1,4-5", "items=0-1", "bytes=a-b"]) {
      expect(byteRange(header, 10)).toBeNull();
    }
  });
});
