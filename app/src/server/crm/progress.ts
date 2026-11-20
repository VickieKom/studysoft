// «Прогресс» on the student card (#255): the results by skill the teacher
// enters by hand — a date and a percent per skill — and the dashboard built
// from them, the homework submitted, the textbook covered and the words. The
// monthly assessment will write the same results (#252–#254). The parent's
// page shows the same dashboard (#256); never a student procedure.
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { PROGRESS_SKILLS, type Skill, type SkillResult, unitsPassed } from "../../domain/progress";
import { MASTERED_STEP } from "../../domain/word-training";
import type { Database } from "../db/client";
import { homework, skillResult, vocabularyWord } from "../db/schema";
import { passedLesson, studentWithTextbook } from "../lesson/prep";

/** The student's results, oldest first. */
export async function listSkillResults(db: Database, teacherId: string, studentId: string): Promise<SkillResult[]> {
  const rows = await db
    .select({ skill: skillResult.skill, percent: skillResult.percent, measuredOn: skillResult.measuredOn })
    .from(skillResult)
    .where(and(eq(skillResult.teacherId, teacherId), eq(skillResult.studentId, studentId)))
    .orderBy(asc(skillResult.measuredOn));
  return rows.map((r) => ({ ...r, skill: r.skill as Skill }));
}

/**
 * The results of one date, as the teacher's form has them: they replace
 * whatever that date had (and, when the date itself was changed, what
 * `previousDate` had), in one transaction. A skill left out has no result.
 */
export async function saveSkillResults(
  db: Database,
  teacherId: string,
  studentId: string,
  date: string,
  results: Partial<Record<Skill, number>>,
  previousDate: string | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const day of new Set([date, previousDate ?? date])) {
      await tx
        .delete(skillResult)
        .where(and(eq(skillResult.teacherId, teacherId), eq(skillResult.studentId, studentId), eq(skillResult.measuredOn, day)));
    }
    const rows = PROGRESS_SKILLS.flatMap((skill) =>
      results[skill] === undefined ? [] : [{ teacherId, studentId, skill, percent: results[skill]!, measuredOn: date }],
    );
    if (rows.length > 0) await tx.insert(skillResult).values(rows);
  });
}

/** «Удалить»: the results of one date. */
export async function deleteSkillResults(db: Database, teacherId: string, studentId: string, date: string): Promise<void> {
  await db
    .delete(skillResult)
    .where(and(eq(skillResult.teacherId, teacherId), eq(skillResult.studentId, studentId), eq(skillResult.measuredOn, date)));
}

/** The rest of the dashboard: homework submitted of those due, the textbook covered, the words and how many are learnt (#240). */
export async function progressTotals(db: Database, teacherId: string, studentId: string) {
  const [work] = await db
    .select({
      submitted: sql<number>`count(*) filter (where ${homework.status} = 'submitted')::int`,
      missed: sql<number>`count(*) filter (where ${homework.status} = 'missed')::int`,
    })
    .from(homework)
    .where(and(eq(homework.teacherId, teacherId), eq(homework.studentId, studentId)));
  const [words] = await db
    .select({
      total: sql<number>`count(*)::int`,
      learnt: sql<number>`count(*) filter (where ${gte(vocabularyWord.trainStep, MASTERED_STEP)})::int`,
    })
    .from(vocabularyWord)
    .where(and(eq(vocabularyWord.teacherId, teacherId), eq(vocabularyWord.studentId, studentId)));
  const book = await studentWithTextbook(db, teacherId, studentId);
  const passed = book?.textbookId ? await passedLesson(db, teacherId, studentId) : null;
  const units = unitsPassed(book?.structure ?? null, passed);
  return {
    homework: { submitted: work?.submitted ?? 0, due: (work?.submitted ?? 0) + (work?.missed ?? 0) },
    textbook: book?.textbookTitle && book.structure ? { title: book.textbookTitle, unitsPassed: units.passed, units: units.total } : null,
    words: { total: words?.total ?? 0, learnt: words?.learnt ?? 0 },
  };
}

/** The dashboard as the teacher's card and the parent's page show it. */
export async function progressView(db: Database, teacherId: string, studentId: string) {
  return { results: await listSkillResults(db, teacherId, studentId), ...(await progressTotals(db, teacherId, studentId)) };
}
