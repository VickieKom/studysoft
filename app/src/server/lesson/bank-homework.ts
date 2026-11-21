// A lesson's homework built from the task bank (#226). In «Подготовка» the
// teacher sees the confirmed tasks of the plan's book lessons as the child
// will see them, checks some and builds: they are appended to the homework
// draft attached to the lesson, or make a new draft «Домашка: урок X.Y»
// attached to it. The tasks are copied with their stored files' references,
// so a later edit of the bank leaves the built homework as it was.
import { and, eq, isNull, sql } from "drizzle-orm";
import { HOMEWORK_FORMAT_VERSION, homeworkSchema, type Task } from "../../domain/homework-format";
import type { LessonPlan } from "../../domain/lesson-plan";
import { MAX_LESSON_TASKS } from "../../domain/task-bank";
import type { Database } from "../db/client";
import { draftOrigin, homework, lessonPlan } from "../db/schema";
import { bankTaskViews, readConfirmedTasks } from "../library/task-bank";
import { findPreparation, ownLesson, studentWithTextbook } from "./prep";

/** The book lessons of the lesson's plan as the page shows it, each with its confirmed bank tasks or null. */
export async function prepBankTasks(db: Database, teacherId: string, lessonId: string) {
  const prep = await findPreparation(db, teacherId, lessonId);
  if (!prep) return null;
  const withBook = await studentWithTextbook(db, teacherId, prep.studentId);
  const textbookId = withBook?.textbookId;
  const bookLessons = [...new Set((prep.start as LessonPlan).stages.flatMap((stage) => (stage.type === "book" ? [stage.lessonId] : [])))];
  const result = [];
  for (const bookLessonId of bookLessons) {
    const title = prep.lessons.find((l) => l.id === bookLessonId)?.title;
    if (!title || !textbookId) continue;
    const bank = await readConfirmedTasks(db, teacherId, textbookId, bookLessonId);
    result.push({
      bookLessonId,
      title,
      textbookId,
      confirmed: bank ? { tasks: bankTaskViews(bank.entryId, "tasks", bank.tasks), revision: bank.revision } : null,
    });
  }
  return result;
}

type Built = { homeworkId: string } | "not_found" | "conflict" | { errors: string[] };

/**
 * «Собрать домашку»: the checked tasks (`picks`, by their place in the bank
 * as the page showed it, `revision`) appended to the student's draft
 * `homeworkId`, or a new draft when there is none; either way attached to the
 * lesson. The draft is locked while it grows, so two builds never lose one
 * another's tasks.
 */
export async function buildHomeworkFromBank(
  db: Database,
  teacherId: string,
  lessonId: string,
  bookLessonId: string,
  picks: number[],
  revision: string,
  homeworkId: string | null,
): Promise<Built> {
  const found = await ownLesson(db, teacherId, lessonId);
  if (!found) return "not_found";
  const withBook = await studentWithTextbook(db, teacherId, found.studentId);
  const title = withBook?.structure?.units.flatMap((u) => u.lessons).find((l) => l.id === bookLessonId)?.title;
  if (!withBook?.textbookId || !title) return "not_found";
  const bank = await readConfirmedTasks(db, teacherId, withBook.textbookId, bookLessonId);
  if (!bank) return "not_found";
  // The bank changed since the page showed it: the checked places may name other tasks now.
  if (bank.revision !== revision) return "conflict";
  const chosen = [...new Set(picks)].sort((a, b) => a - b);
  if (chosen.length === 0) return { errors: ["Отметьте задания, которые взять в домашку"] };
  if (chosen.some((i) => i >= bank.tasks.length)) return "conflict";
  const copied: Task[] = chosen.map((i) => structuredClone(bank.tasks[i]!));

  return db.transaction(async (tx) => {
    let id: string;
    if (homeworkId) {
      const [draft] = await tx
        .select({ document: homework.document })
        .from(homework)
        .where(and(eq(homework.id, homeworkId), eq(homework.teacherId, teacherId), eq(homework.studentId, found.studentId), eq(homework.status, "draft")))
        .for("update");
      if (!draft) return { errors: ["Домашка к уроку — черновик этого ученика"] };
      const document = homeworkSchema.parse(draft.document);
      const tasks = [...document.tasks, ...copied];
      if (tasks.length > MAX_LESSON_TASKS) return { errors: [`В домашке не больше ${MAX_LESSON_TASKS} заданий`] };
      await tx.update(homework).set({ document: homeworkSchema.parse({ ...document, tasks }) }).where(eq(homework.id, homeworkId));
      // An assistant's draft the teacher added to is hers now: the assistant's next save makes a new one (#43).
      await tx
        .update(draftOrigin)
        .set({ teacherEditedAt: sql`now()` })
        .where(and(eq(draftOrigin.homeworkId, homeworkId), isNull(draftOrigin.teacherEditedAt)));
      id = homeworkId;
    } else {
      const document = homeworkSchema.parse({ version: HOMEWORK_FORMAT_VERSION, title: `Домашка: урок ${title}`, tasks: copied });
      const [row] = await tx
        .insert(homework)
        .values({ teacherId, studentId: found.studentId, title: document.title, document })
        .returning({ id: homework.id });
      id = row!.id;
    }
    await tx
      .insert(lessonPlan)
      .values({ lessonId, teacherId, homeworkId: id })
      .onConflictDoUpdate({ target: lessonPlan.lessonId, set: { homeworkId: id, updatedAt: sql`now()` }, setWhere: eq(lessonPlan.teacherId, teacherId) });
    return { homeworkId: id };
  });
}
