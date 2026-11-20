import { describe, expect, it } from "vitest";
import { boardSchema, clearSheet, cleanBoard, draw, MAX_ITEMS, MAX_SHEETS, newSheet, sheetLabel, turnSheet, undo } from "./board";
import { initialState, lessonStateSchema } from "./lesson-state";

const word = (text: string) => ({ kind: "text" as const, x: 10, y: 20, text, colour: "white" as const });
const texts = (board: ReturnType<typeof cleanBoard>) => board.sheets[board.current]!.items.flatMap((i) => (i.kind === "text" ? [i.text] : []));

describe("the chalkboard (#155)", () => {
  it("starts clean, one sheet", () => {
    expect(cleanBoard()).toEqual({ sheets: [{ items: [], previous: null }], current: 0 });
    expect(sheetLabel(cleanBoard())).toBe("лист 1 из 1");
  });

  it("keeps the earlier sheets: a new one is empty and current, ‹ goes back, never past the ends", () => {
    const first = draw(cleanBoard(), word("kitten"));
    const second = newSheet(first);
    expect(sheetLabel(second)).toBe("лист 2 из 2");
    expect(texts(second)).toEqual([]);
    const back = turnSheet(second, -1);
    expect(sheetLabel(back)).toBe("лист 1 из 2");
    expect(texts(back)).toEqual(["kitten"]);
    expect(turnSheet(back, -1)).toBe(back);
    expect(turnSheet(second, 1)).toBe(second);
  });

  it("«Очистить» empties the sheet and «Вернуть» brings it back; the other sheets are untouched", () => {
    const board = turnSheet(newSheet(draw(cleanBoard(), word("kitten"))), -1);
    const cleared = clearSheet(board);
    expect(texts(cleared)).toEqual([]);
    expect(cleared.sheets[1]).toEqual(board.sheets[1]);
    expect(texts(undo(cleared))).toEqual(["kitten"]);
    // Nothing more to bring back after that.
    expect(undo(undo(cleared))).toEqual(undo(cleared));
  });

  it("«Вернуть» takes back the last thing drawn", () => {
    const board = draw(draw(cleanBoard(), word("one")), word("two"));
    expect(texts(undo(board))).toEqual(["one"]);
  });

  it("stops at its limits: sheets and items", () => {
    let board = cleanBoard();
    for (let i = 0; i < MAX_SHEETS + 3; i++) board = newSheet(board);
    expect(board.sheets).toHaveLength(MAX_SHEETS);
    let full = cleanBoard();
    for (let i = 0; i < MAX_ITEMS + 3; i++) full = draw(full, word(`w${i}`));
    expect(full.sheets[0]!.items).toHaveLength(MAX_ITEMS);
  });

  it("refuses text too long, points off the sheet and a sheet that is not there", () => {
    expect(boardSchema.safeParse(draw(cleanBoard(), word("x".repeat(121)))).success).toBe(false);
    expect(boardSchema.safeParse(draw(cleanBoard(), { kind: "stroke", points: [[999, 10]], colour: "white" })).success).toBe(false);
    expect(boardSchema.safeParse({ ...cleanBoard(), current: 1 }).success).toBe(false);
  });

  it("is part of the lesson state: a lesson starts with a clean board, and a state kept before the board gets one", () => {
    const state = initialState({ stages: [] }, [], [], new Date("2026-11-20T10:00:00Z"));
    expect(state.board).toEqual(cleanBoard());
    const { board: _, ...older } = state;
    expect(lessonStateSchema.parse(older).board).toEqual(cleanBoard());
  });

  it("«Доска крупно» (#205) is off when a lesson starts, and off for a state kept before it", () => {
    const state = initialState({ stages: [] }, [], [], new Date("2026-11-20T10:00:00Z"));
    expect(state.boardLarge).toBe(false);
    const { boardLarge: _, ...older } = state;
    expect(lessonStateSchema.parse(older).boardLarge).toBe(false);
    expect(lessonStateSchema.parse({ ...state, boardLarge: true }).boardLarge).toBe(true);
  });
});
