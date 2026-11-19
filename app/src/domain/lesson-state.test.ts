import { describe, expect, it } from "vitest";
import {
  type BookLesson,
  firstBook,
  goToStage,
  initialState,
  type LessonBook,
  type LessonState,
  lessonStateSchema,
  newer,
  pageIn,
  removeStage,
  shownPages,
  turnPage,
} from "./lesson-state";

const LESSON = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const MATERIAL = "00000000-0000-4000-8000-000000000003";

const books: LessonBook[] = [
  { kind: "students_book", fileId: "00000000-0000-4000-8000-0000000000a1", pageCount: 8 },
  { kind: "workbook", fileId: "00000000-0000-4000-8000-0000000000a2", pageCount: 4 },
];
const lessons: BookLesson[] = [
  { id: LESSON, title: "1.2", pages: { students_book: { from: 4, to: 5 }, workbook: { from: 2, to: 2 } }, tracks: ["1-02"] },
  { id: OTHER, title: "WB only", pages: { workbook: { from: 3, to: 3 } }, tracks: [] },
];

const now = new Date("2026-11-19T10:00:00Z");

function started(): LessonState {
  return initialState(
    {
      stages: [
        { type: "material", materialId: MATERIAL, minutes: 5 },
        { type: "book", lessonId: LESSON, skip: "3", minutes: 25 },
        { type: "book", lessonId: OTHER, skip: "", minutes: 10 },
      ],
    },
    lessons,
    books,
    now,
  );
}

describe("shownPages", () => {
  it("shows one page in the one-page layout", () => {
    expect(shownPages(5, "single", 8)).toEqual([5]);
  });
  it("shows the spread holding the page: even on the left", () => {
    expect(shownPages(4, "spread", 8)).toEqual([4, 5]);
    expect(shownPages(5, "spread", 8)).toEqual([4, 5]);
  });
  it("shows the first page alone, and a last even page alone", () => {
    expect(shownPages(1, "spread", 8)).toEqual([1]);
    expect(shownPages(8, "spread", 8)).toEqual([8]);
  });
});

describe("turnPage", () => {
  it("turns by a page, past the lesson's pages, within the book", () => {
    expect(turnPage(5, 1, "single", 8)).toBe(6);
    expect(turnPage(1, -1, "single", 8)).toBe(1);
    expect(turnPage(8, 1, "single", 8)).toBe(8);
  });
  it("turns by a spread", () => {
    expect(turnPage(4, 1, "spread", 8)).toBe(6);
    expect(turnPage(5, -1, "spread", 8)).toBe(3);
    expect(turnPage(2, -1, "spread", 8)).toBe(1);
  });
});

describe("initialState", () => {
  it("starts on the first stage, each book stage at its lesson's first page", () => {
    const state = started();
    expect(lessonStateSchema.safeParse(state).success).toBe(true);
    expect(state.current).toBe(0);
    expect(state.layout).toBe("single");
    expect(state.track).toBeNull();
    expect(state.startedAt).toBe(now.toISOString());
    expect(state.stages[1]).toMatchObject({ type: "book", kind: "students_book", pages: { students_book: 4 }, done: false });
  });
  it("opens a lesson without Student's Book pages in the book it has pages in", () => {
    expect(started().stages[2]).toMatchObject({ kind: "workbook", pages: { workbook: 3 } });
    expect(firstBook(lessons[1], books)).toBe("workbook");
  });
  it("skips a book that is not rendered yet", () => {
    expect(firstBook(lessons[0], [{ ...books[0]!, pageCount: 0 }, books[1]!])).toBe("workbook");
  });
});

describe("pageIn", () => {
  it("is where the book was left, else the lesson's first page in it", () => {
    const stage = started().stages[1];
    if (stage?.type !== "book") throw new Error("a book stage");
    expect(pageIn(stage, lessons[0], "students_book")).toBe(4);
    expect(pageIn(stage, lessons[0], "workbook")).toBe(2);
    expect(pageIn({ ...stage, pages: { workbook: 4 } }, lessons[0], "workbook")).toBe(4);
  });
});

describe("goToStage and removeStage", () => {
  it("ticks the stage left", () => {
    const state = goToStage(started(), 1);
    expect(state.current).toBe(1);
    expect(state.stages.map((s) => s.done)).toEqual([true, false, false]);
  });
  it("ignores a stage that does not exist", () => {
    const state = started();
    expect(goToStage(state, 5)).toBe(state);
  });
  it("keeps the current stage current when one before it is removed", () => {
    const state = removeStage(goToStage(started(), 2), 0);
    expect(state.stages).toHaveLength(2);
    expect(state.current).toBe(1);
  });
  it("moves to the next stage when the current one is removed, and to the last when it was the last", () => {
    expect(removeStage(goToStage(started(), 1), 1).current).toBe(1);
    expect(removeStage(goToStage(started(), 2), 2).current).toBe(1);
    expect(removeStage({ ...started(), stages: [started().stages[0]!], current: 0 }, 0).current).toBe(0);
  });
});

describe("lessonStateSchema", () => {
  it("refuses a current stage past the last", () => {
    expect(lessonStateSchema.safeParse({ ...started(), current: 3 }).success).toBe(false);
  });
});

describe("newer", () => {
  it("takes the larger revision, the first one on a tie", () => {
    const a = { revision: 3, state: started() };
    const b = { revision: 4, state: started() };
    expect(newer(a, b)).toBe(b);
    expect(newer(b, a)).toBe(b);
    expect(newer(a, { ...a })).toBe(a);
    expect(newer(null, a)).toBe(a);
    expect(newer(a, null)).toBe(a);
  });
});
