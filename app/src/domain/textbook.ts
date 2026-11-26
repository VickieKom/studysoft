// Textbook sets (#156): the kinds of files a set holds and the limits the
// product owner set (2026-11-18). Plain data only.

/** The books of a set, in the order the textbook's page shows them; the teacher's book (#414) is optional, as every book is. */
export const BOOK_KINDS = ["students_book", "workbook", "teachers_book"] as const;
export type BookKind = (typeof BOOK_KINDS)[number];

/**
 * The books a lesson stage can show (#414). The stage is what the child sees,
 * and the teacher's book holds the answers: it is never one of them.
 */
export const STAGE_BOOK_KINDS = ["students_book", "workbook"] as const;
export type StageBookKind = (typeof STAGE_BOOK_KINDS)[number];

export function isStageBook(kind: BookKind): kind is StageBookKind {
  return (STAGE_BOOK_KINDS as readonly string[]).includes(kind);
}

export const BOOK_LABELS: Record<BookKind, string> = {
  students_book: "Student's Book",
  workbook: "Workbook",
  teachers_book: "Teacher's Book",
};

/** The largest book PDF (product owner, 2026-11-18). */
export const MAX_BOOK_BYTES = 300 * 1024 * 1024;
/** The largest folder of tracks, all tracks together (product owner, 2026-11-18). */
export const MAX_TRACKS_BYTES = 500 * 1024 * 1024;
/** The most tracks in one set: a few CDs' worth. */
export const MAX_TRACKS = 300;
/** The most videos in one set (#329); each is at most a library video's 200 MB (MAX_VIDEO_BYTES). */
export const MAX_TEXTBOOK_VIDEOS = 100;

export const RENDER_STATUSES = ["rendering", "done", "failed"] as const;
export type RenderStatus = (typeof RENDER_STATUSES)[number];

export const RENDER_LABELS: Record<RenderStatus, string> = {
  rendering: "Готовится",
  done: "Готов",
  failed: "Не получилось",
};
