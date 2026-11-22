// The intro's brief (#339). «Бриф вводного» in «Настройки» is the teacher's
// template: the platform's starting set until she changes it, her options
// and questions after. On a request the brief is filled in during the intro,
// saved as she goes; its first save keeps the questions it was filled in
// with, so a later change of the template leaves it alone. «Удобное время»
// is always there, outside the template. The teacher's only.
import { and, eq, isNull, sql } from "drizzle-orm";
import { type BriefAnswer, type BriefQuestion, type ConvenientTime, STARTING_BRIEF } from "../../domain/brief";
import type { Database } from "../db/client";
import { clientRequest, clientRequestBrief, introBriefTemplate } from "../db/schema";
import { teacherTimeZone } from "../access/settings";

/** The teacher's template, or the platform's starting set when she has saved none. */
export async function briefTemplate(database: Database, teacherId: string): Promise<BriefQuestion[]> {
  const [row] = await database.select({ questions: introBriefTemplate.questions }).from(introBriefTemplate).where(eq(introBriefTemplate.teacherId, teacherId));
  return (row?.questions as BriefQuestion[] | undefined) ?? STARTING_BRIEF;
}

/** Saves the template whole, as her editor has it; briefs already filled in keep their own questions. */
export async function saveBriefTemplate(database: Database, teacherId: string, questions: BriefQuestion[]): Promise<void> {
  await database
    .insert(introBriefTemplate)
    .values({ teacherId, questions })
    .onConflictDoUpdate({ target: introBriefTemplate.teacherId, set: { questions, updatedAt: sql`now()` } });
}

export type Brief = { questions: BriefQuestion[]; answers: Record<string, BriefAnswer>; convenientTime: ConvenientTime; saved: boolean };

/** A request of this teacher that is not deleted. */
async function ownRequest(database: Database, teacherId: string, requestId: string) {
  const [row] = await database
    .select({ id: clientRequest.id })
    .from(clientRequest)
    .where(and(eq(clientRequest.id, requestId), eq(clientRequest.teacherId, teacherId), isNull(clientRequest.deletedAt)));
  return row ?? null;
}

/**
 * The request's brief: as saved, or, before its first save, the template's
 * questions now and «Удобное время» in the teacher's time zone. Null when the
 * request is not this teacher's.
 */
export async function requestBrief(database: Database, teacherId: string, requestId: string): Promise<Brief | null> {
  if (!(await ownRequest(database, teacherId, requestId))) return null;
  const [row] = await database
    .select({ questions: clientRequestBrief.questions, answers: clientRequestBrief.answers, convenientTime: clientRequestBrief.convenientTime })
    .from(clientRequestBrief)
    .where(eq(clientRequestBrief.requestId, requestId));
  if (row) {
    return {
      questions: row.questions as BriefQuestion[],
      answers: row.answers as Record<string, BriefAnswer>,
      convenientTime: row.convenientTime as ConvenientTime,
      saved: true,
    };
  }
  const timeZone = (await teacherTimeZone(database, teacherId)) as ConvenientTime["timeZone"];
  return { questions: await briefTemplate(database, teacherId), answers: {}, convenientTime: { timeZone, days: [], ranges: [] }, saved: false };
}

/**
 * Saves the brief as the teacher fills it in. Its first save keeps the
 * questions her page showed; later saves keep those and change only the
 * answers and the time. An answer to a question the brief does not have, or
 * a choice the question does not offer, is "invalid".
 */
export async function saveRequestBrief(
  database: Database,
  teacherId: string,
  requestId: string,
  brief: { questions: BriefQuestion[]; answers: Record<string, BriefAnswer>; convenientTime: ConvenientTime },
): Promise<"saved" | "not_found" | "invalid"> {
  if (!(await ownRequest(database, teacherId, requestId))) return "not_found";
  const [existing] = await database.select({ questions: clientRequestBrief.questions }).from(clientRequestBrief).where(eq(clientRequestBrief.requestId, requestId));
  const questions = (existing?.questions as BriefQuestion[] | undefined) ?? brief.questions;
  const byId = new Map(questions.map((q) => [q.id, q]));
  const fits = Object.entries(brief.answers).every(([id, answer]) => {
    const question = byId.get(id);
    return question !== undefined && answer.choices.every((c) => question.options.includes(c));
  });
  if (!fits) return "invalid";
  await database
    .insert(clientRequestBrief)
    .values({ requestId, teacherId, questions, answers: brief.answers, convenientTime: brief.convenientTime })
    .onConflictDoUpdate({
      target: clientRequestBrief.requestId,
      set: { answers: brief.answers, convenientTime: brief.convenientTime, updatedAt: sql`now()` },
      setWhere: eq(clientRequestBrief.teacherId, teacherId),
    });
  return "saved";
}
