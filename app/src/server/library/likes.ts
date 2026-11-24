// «нравится N детям» in the library (#334): a game, a warm-up or a video a
// child picked as more fun in a survey's pair (#332), or both of a pair with
// «Оба классные», counts as liked by that child, once per material however
// often. Only this teacher's children count. Counted from the answered
// surveys whenever the library is shown.
import { and, eq } from "drizzle-orm";
import { BOTH_FUN, type SurveyQuestion } from "../../domain/survey";
import type { Database } from "../db/client";
import { homeworkSurvey } from "../db/schema";

/** The materials liked by this teacher's children, each with how many children. */
export async function materialLikes(database: Database, teacherId: string): Promise<Map<string, number>> {
  const rows = await database
    .select({ studentId: homeworkSurvey.studentId, questions: homeworkSurvey.questions, answers: homeworkSurvey.answers })
    .from(homeworkSurvey)
    .where(and(eq(homeworkSurvey.teacherId, teacherId), eq(homeworkSurvey.status, "answered")));
  const children = new Map<string, Set<string>>();
  const like = (materialId: string, studentId: string) => children.set(materialId, (children.get(materialId) ?? new Set()).add(studentId));
  for (const row of rows) {
    const questions = row.questions as SurveyQuestion[];
    const answers = (row.answers as (string | null)[] | null) ?? [];
    questions.forEach((question, i) => {
      if (question.kind !== "fun") return;
      const answer = answers[i];
      if (answer === question.a.title || answer === BOTH_FUN) like(question.a.id, row.studentId);
      if (answer === question.b.title || answer === BOTH_FUN) like(question.b.id, row.studentId);
    });
  }
  return new Map([...children].map(([id, set]) => [id, set.size]));
}
