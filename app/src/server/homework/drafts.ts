// The assistant's homework drafts (#43). The assistant only ever creates or
// replaces drafts; publishing, taking back and deleting stay with the teacher
// (AGENTS.md, rule 5). Each draft keeps the student context it was built on.
import { and, desc, eq, isNull } from "drizzle-orm";
import { type HomeworkDocument, homeworkSchema } from "../../domain/homework-format";
import type { StudentContext } from "../crm/context";
import type { Database } from "../db/client";
import { draftOrigin, homework } from "../db/schema";

/**
 * The assistant's latest draft of this student that it may replace: still a
 * draft, and not edited by the teacher. Null when there is none.
 */
export async function replaceableDraft(
  db: Pick<Database, "select">,
  teacherId: string,
  studentId: string,
): Promise<{ id: string; document: HomeworkDocument } | null> {
  const [row] = await db
    .select({ id: homework.id, document: homework.document })
    .from(homework)
    .innerJoin(draftOrigin, eq(draftOrigin.homeworkId, homework.id))
    .where(
      and(
        eq(homework.teacherId, teacherId),
        eq(homework.studentId, studentId),
        eq(homework.status, "draft"),
        isNull(draftOrigin.teacherEditedAt),
      ),
    )
    .orderBy(desc(homework.createdAt))
    .limit(1);
  return row ? { id: row.id, document: row.document as HomeworkDocument } : null;
}

/**
 * Saves a validated homework as the assistant's draft for a student of this
 * teacher: replaces its untouched draft, or creates a new one. Returns the
 * draft's id.
 */
export async function saveAssistantDraft(
  db: Database,
  teacherId: string,
  studentId: string,
  document: HomeworkDocument,
  context: StudentContext,
): Promise<string> {
  return db.transaction(async (tx) => {
    const existing = await replaceableDraft(tx, teacherId, studentId);
    if (existing) {
      // Conditional on still being an untouched draft: a publish or an edit meanwhile wins.
      const [replaced] = await tx
        .update(homework)
        .set({ document, title: document.title })
        .where(and(eq(homework.id, existing.id), eq(homework.status, "draft")))
        .returning({ id: homework.id });
      const [origin] = await tx
        .update(draftOrigin)
        .set({ context })
        .where(and(eq(draftOrigin.homeworkId, existing.id), isNull(draftOrigin.teacherEditedAt)))
        .returning({ id: draftOrigin.id });
      if (replaced && origin) return existing.id;
    }
    const [created] = await tx
      .insert(homework)
      .values({ teacherId, studentId, title: document.title, document: homeworkSchema.parse(document) })
      .returning({ id: homework.id });
    if (!created) throw new Error("saveAssistantDraft: insert returned no row");
    await tx.insert(draftOrigin).values({ homeworkId: created.id, createdBy: "agent", context });
    return created.id;
  });
}

/** The assistant's latest draft of this student, edited by the teacher or not; null when none. */
export async function readAssistantDraft(
  db: Database,
  teacherId: string,
  studentId: string,
): Promise<{ id: string; homework: HomeworkDocument } | null> {
  const [row] = await db
    .select({ id: homework.id, document: homework.document })
    .from(homework)
    .innerJoin(draftOrigin, eq(draftOrigin.homeworkId, homework.id))
    .where(and(eq(homework.teacherId, teacherId), eq(homework.studentId, studentId), eq(homework.status, "draft")))
    .orderBy(desc(homework.createdAt))
    .limit(1);
  return row ? { id: row.id, homework: row.document as HomeworkDocument } : null;
}
