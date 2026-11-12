// Homework drafts and their publication (#32). The document is stored as
// imported and never changes after publishing; what a student may see of it
// is studentView() — without the keys (AGENTS.md, rule 4).
import { and, desc, eq, sql } from "drizzle-orm";
import { type HomeworkDocument, homeworkSchema, type StudentTask, studentView } from "../../domain/homework-format";
import type { Database } from "../db/client";
import { homework } from "../db/schema";

export const HOMEWORK_STATUSES = ["draft", "published", "missed"] as const;
export type HomeworkStatus = (typeof HOMEWORK_STATUSES)[number];

export type HomeworkSummary = {
  id: string;
  title: string;
  status: HomeworkStatus;
  dueDate: string | null;
  taskCount: number;
  createdAt: Date;
};

const summaryColumns = {
  id: homework.id,
  title: homework.title,
  status: homework.status,
  dueDate: homework.dueDate,
  document: homework.document,
  createdAt: homework.createdAt,
};

type Row = { id: string; title: string; status: string; dueDate: string | null; document: unknown; createdAt: Date };

function taskCount(document: unknown): number {
  return (document as HomeworkDocument).tasks.length;
}

function toSummary(row: Row): HomeworkSummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status as HomeworkStatus,
    dueDate: row.dueDate,
    taskCount: taskCount(row.document),
    createdAt: row.createdAt,
  };
}

/** Saves an already validated document as a draft for one student of this teacher. */
export async function importDraft(
  db: Database,
  teacherId: string,
  studentId: string,
  document: HomeworkDocument,
): Promise<string> {
  const [row] = await db
    .insert(homework)
    .values({ teacherId, studentId, title: document.title, document: homeworkSchema.parse(document) })
    .returning({ id: homework.id });
  if (!row) throw new Error("importDraft: insert returned no row");
  return row.id;
}

/** The student's homework, newest first. */
export async function listHomework(db: Database, teacherId: string, studentId: string): Promise<HomeworkSummary[]> {
  const rows = await db
    .select(summaryColumns)
    .from(homework)
    .where(and(eq(homework.teacherId, teacherId), eq(homework.studentId, studentId)))
    .orderBy(desc(homework.createdAt));
  return rows.map(toSummary);
}

/** One homework of this teacher for the preview: tasks as the student sees them. */
export async function findHomework(
  db: Database,
  teacherId: string,
  id: string,
): Promise<(HomeworkSummary & { studentId: string; tasks: StudentTask[] }) | null> {
  const [row] = await db
    .select({ ...summaryColumns, studentId: homework.studentId })
    .from(homework)
    .where(and(eq(homework.id, id), eq(homework.teacherId, teacherId)));
  if (!row) return null;
  return {
    ...toSummary(row),
    studentId: row.studentId,
    tasks: (row.document as HomeworkDocument).tasks.map(studentView),
  };
}

/**
 * Publishes a draft with a deadline. The student's previously published
 * homework is closed as "missed" in the same transaction (product
 * requirements 5.1.6, item 4). Returns false when there is no such draft.
 */
export async function publishHomework(db: Database, teacherId: string, id: string, dueDate: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [draft] = await tx
      .select({ studentId: homework.studentId })
      .from(homework)
      .where(and(eq(homework.id, id), eq(homework.teacherId, teacherId), eq(homework.status, "draft")))
      .for("update");
    if (!draft) return false;
    // shortcut: every published homework counts as unsubmitted until submissions exist (#34)
    await tx
      .update(homework)
      .set({ status: "missed" })
      .where(and(eq(homework.studentId, draft.studentId), eq(homework.teacherId, teacherId), eq(homework.status, "published")));
    await tx
      .update(homework)
      .set({ status: "published", dueDate, publishedAt: sql`now()` })
      .where(eq(homework.id, id));
    return true;
  });
}

/**
 * Takes a published homework back to a draft before the student submits.
 * Returns false when there is no such published homework.
 */
export async function unpublishHomework(db: Database, teacherId: string, id: string): Promise<boolean> {
  // shortcut: nothing can be submitted yet; #34 must refuse this once a submission exists
  const rows = await db
    .update(homework)
    .set({ status: "draft", dueDate: null, publishedAt: null })
    .where(and(eq(homework.id, id), eq(homework.teacherId, teacherId), eq(homework.status, "published")))
    .returning({ id: homework.id });
  return rows.length > 0;
}

/** What the student's page shows: the current published homework, without its tasks yet (#34). */
export async function currentHomeworkForStudent(
  db: Database,
  teacherId: string,
  studentId: string,
): Promise<{ dueDate: string; taskCount: number } | null> {
  const [row] = await db
    .select({ dueDate: homework.dueDate, document: homework.document })
    .from(homework)
    .where(and(eq(homework.teacherId, teacherId), eq(homework.studentId, studentId), eq(homework.status, "published")));
  if (!row || !row.dueDate) return null;
  return { dueDate: row.dueDate, taskCount: taskCount(row.document) };
}
