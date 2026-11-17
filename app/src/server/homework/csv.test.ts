import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("splits plain fields and keeps empty ones", () => {
    expect(parseCsv("a,b,c\n1,,3\n")).toEqual([
      { line: 1, fields: ["a", "b", "c"] },
      { line: 2, fields: ["1", "", "3"] },
    ]);
  });

  it("reads quoted fields with commas, doubled quotes and line breaks", () => {
    expect(parseCsv('x,"one, two","say ""hi""","line\nbreak"\nnext,row')).toEqual([
      { line: 1, fields: ["x", "one, two", 'say "hi"', "line\nbreak"] },
      { line: 3, fields: ["next", "row"] },
    ]);
  });

  it("takes CRLF line ends, a byte order mark and no final line break, and skips blank lines", () => {
    expect(parseCsv("﻿a,b\r\n\r\n1,2")).toEqual([
      { line: 1, fields: ["a", "b"] },
      { line: 3, fields: ["1", "2"] },
    ]);
  });

  it("keeps a record of one empty quoted field", () => {
    expect(parseCsv('""\n')).toEqual([{ line: 1, fields: [""] }]);
  });
});
