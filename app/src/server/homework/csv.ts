// A small CSV reader for the history import (#38): UTF-8, comma-separated,
// fields optionally in double quotes, a doubled quote inside quotes for a
// quote, line breaks inside quotes kept. Enough for files a spreadsheet
// exports; no dependency for a few lines (AGENTS.md, rule 11).

/** The records of a CSV text, each with the line it starts on (from 1). Blank lines are skipped. */
export function parseCsv(text: string): { line: number; fields: string[] }[] {
  const source = text.startsWith("﻿") ? text.slice(1) : text;
  const records: { line: number; fields: string[] }[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let start = 1;
  let touched = false;

  const endRecord = () => {
    fields.push(field);
    if (touched || fields.length > 1 || field !== "") records.push({ line: start, fields });
    fields = [];
    field = "";
    touched = false;
  };

  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        if (char === "\n") line++;
        field += char;
      }
      continue;
    }
    if (char === '"' && field === "") {
      quoted = true;
      touched = true;
    } else if (char === ",") {
      fields.push(field);
      field = "";
      touched = true;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      endRecord();
      line++;
      start = line;
    } else {
      field += char;
    }
  }
  if (field !== "" || fields.length > 0 || touched) endRecord();
  return records;
}
