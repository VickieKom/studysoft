// «Привлечение клиентов» (#337): the requests of families who may become
// students, by stage. The teacher adds one, moves it to any stage forward or
// back — «Отказ» with a reason and an optional comment, cleared when it
// leaves «Отказ» — and deletes it. A deleted request keeps no name, age,
// school year, contact or comment: only its stage, source, reason and date,
// as an anonymous count for the metrics (#341). The teacher's only.
//
// The intro lesson (#338): «Записать на вводный» gives the child a hidden
// card (`CANDIDATE_STATUS`) the first time, and a free lesson of the kind
// "intro" on it, so the schedule, the prep and the stage work as they are.
// The request follows its intro lessons: one held — «Вводный проведён»;
// else one scheduled — «Вводный записан»; else «Заявка». Booked from «Заявка» only, one at a time.
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { DeclineReason, RequestSource, RequestStage } from "../../domain/requests";
import { zonedMoment } from "../../domain/schedule";
import { CANDIDATE_STATUS, type Level } from "../../domain/student";
import { teacherTimeZone } from "../access/settings";
import type { Database } from "../db/client";
import {
  clientRequest,
  clientRequestBrief,
  draftOrigin,
  gameAccess,
  gameResult,
  homework,
  homeworkAnswer,
  homeworkFeedback,
  homeworkSubmission,
  homeworkSurvey,
  lesson,
  lessonPlan,
  lessonState,
  student,
  textbookVideoAccess,
  videoAnswer,
  vocabularyWord,
} from "../db/schema";

export type NewRequest = {
  firstName: string;
  age: number | null;
  schoolYear: string | null;
  contact: string | null;
  source: RequestSource;
  requestedOn: string;
};

export type ClientRequest = NewRequest & {
  id: string;
  stage: RequestStage;
  declineReason: DeclineReason | null;
  declineComment: string | null;
  introLevel: Level | null;
  introNotes: string | null;
};

const columns = {
  id: clientRequest.id,
  firstName: clientRequest.firstName,
  age: clientRequest.age,
  schoolYear: clientRequest.schoolYear,
  contact: clientRequest.contact,
  source: clientRequest.source,
  requestedOn: clientRequest.requestedOn,
  stage: clientRequest.stage,
  declineReason: clientRequest.declineReason,
  declineComment: clientRequest.declineComment,
  introLevel: clientRequest.introLevel,
  introNotes: clientRequest.introNotes,
};

/** A request of this teacher that is not deleted. */
const live = (teacherId: string, id: string) => and(eq(clientRequest.id, id), eq(clientRequest.teacherId, teacherId), isNull(clientRequest.deletedAt));

/** «Новая заявка»: saved under «Заявка». */
export async function createRequest(database: Database, teacherId: string, request: NewRequest): Promise<{ id: string }> {
  const [row] = await database.insert(clientRequest).values({ teacherId, ...request }).returning({ id: clientRequest.id });
  if (!row) throw new Error("createRequest: insert returned no row");
  return row;
}

/** The teacher's requests that are not deleted, the newest date first. */
export async function listRequests(database: Database, teacherId: string): Promise<ClientRequest[]> {
  const rows = await database
    .select(columns)
    .from(clientRequest)
    .where(and(eq(clientRequest.teacherId, teacherId), isNull(clientRequest.deletedAt)))
    .orderBy(desc(clientRequest.requestedOn), asc(clientRequest.createdAt));
  return rows as ClientRequest[];
}

/**
 * Moves a request to a stage, any one, forward or back. «Отказ» takes its
 * reason and comment; any other stage clears them. False when there is no
 * such request of this teacher, a deleted one included.
 */
export async function moveRequest(
  database: Database,
  teacherId: string,
  id: string,
  move: { stage: Exclude<RequestStage, "declined"> } | { stage: "declined"; reason: DeclineReason; comment: string | null },
): Promise<boolean> {
  const declined = move.stage === "declined" ? { declineReason: move.reason, declineComment: move.comment } : { declineReason: null, declineComment: null };
  const rows = await database
    .update(clientRequest)
    .set({ stage: move.stage, ...declined, updatedAt: new Date() })
    .where(live(teacherId, id))
    .returning({ id: clientRequest.id });
  return rows.length > 0;
}

/**
 * «Удалить заявку»: the name, age, school year, contact and comment are
 * erased in the row itself; the stage, source, reason and date stay as an
 * anonymous count. False when there is no such request of this teacher.
 */
export async function deleteRequest(database: Database, teacherId: string, id: string): Promise<boolean> {
  return database.transaction(async (tx) => {
    const rows = await tx
      .update(clientRequest)
      .set({ firstName: null, age: null, schoolYear: null, contact: null, declineComment: null, introNotes: null, deletedAt: new Date(), updatedAt: new Date() })
      .where(live(teacherId, id))
      .returning({ id: clientRequest.id, studentId: clientRequest.studentId });
    const [erased] = rows;
    if (!erased) return false;
    // The hidden card carries the child's name and all the intro left (#338): it goes too.
    if (erased.studentId) await eraseCard(tx, teacherId, erased.studentId);
    // The brief is the family's own words (#339): it goes with the rest.
    await tx.delete(clientRequestBrief).where(eq(clientRequestBrief.requestId, id));
    return true;
  });
}

/**
 * Everything the intro left on a request's hidden card (#338), erased with
 * the request (product owner, 2026-11-24): its lessons with their notes, the
 * lesson mode's state and the plan; the games' and videos' results and what
 * was opened to the child; the words of «Завершить урок»; a homework drafted
 * in the prep. The card itself stays, without a name, as the row the
 * anonymous request points to. A hidden card has no page, so nothing else —
 * contacts, notes, payments, a link — can be on it.
 */
async function eraseCard(tx: Pick<Database, "select" | "update" | "delete">, teacherId: string, studentId: string): Promise<void> {
  const ofCard = (table: { teacherId: AnyPgColumn; studentId: AnyPgColumn }) =>
    and(eq(table.studentId, studentId), eq(table.teacherId, teacherId));
  const lessonIds = tx.select({ id: lesson.id }).from(lesson).where(and(eq(lesson.studentId, studentId), eq(lesson.teacherId, teacherId)));
  const homeworkIds = tx.select({ id: homework.id }).from(homework).where(and(eq(homework.studentId, studentId), eq(homework.teacherId, teacherId)));
  await tx.delete(lessonPlan).where(inArray(lessonPlan.lessonId, lessonIds));
  await tx.delete(lessonState).where(inArray(lessonState.lessonId, lessonIds));
  await tx.delete(homeworkAnswer).where(inArray(homeworkAnswer.homeworkId, homeworkIds));
  await tx.delete(homeworkSubmission).where(inArray(homeworkSubmission.homeworkId, homeworkIds));
  await tx.delete(draftOrigin).where(inArray(draftOrigin.homeworkId, homeworkIds));
  await tx.delete(homeworkFeedback).where(ofCard(homeworkFeedback));
  await tx.delete(homeworkSurvey).where(ofCard(homeworkSurvey));
  await tx.delete(homework).where(and(eq(homework.studentId, studentId), eq(homework.teacherId, teacherId)));
  await tx.delete(gameResult).where(ofCard(gameResult));
  await tx.delete(gameAccess).where(ofCard(gameAccess));
  await tx.delete(videoAnswer).where(ofCard(videoAnswer));
  await tx.delete(textbookVideoAccess).where(ofCard(textbookVideoAccess));
  await tx.delete(vocabularyWord).where(ofCard(vocabularyWord));
  await tx.delete(lesson).where(and(eq(lesson.studentId, studentId), eq(lesson.teacherId, teacherId)));
  await tx
    .update(student)
    .set({ firstName: "", lastName: null, passedLessonId: null, deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(student.id, studentId), eq(student.teacherId, teacherId)));
}

/** One request of this teacher that is not deleted, for its page (#339); null when there is none. */
export async function findRequest(database: Database, teacherId: string, id: string): Promise<ClientRequest | null> {
  const [row] = await database.select(columns).from(clientRequest).where(live(teacherId, id));
  return (row as ClientRequest | undefined) ?? null;
}

/** Why «Записать на вводный» is refused: the request is not at «Заявка», or its intro is on the schedule already. */
export type BookingRefusal = { refused: "stage" } | { refused: "scheduled"; startsAt: Date };

/**
 * «Записать на вводный» (#338): a free intro lesson at the teacher's date and
 * time, on the child's hidden card, made the first time; the request moves
 * to «Вводный записан». Only from «Заявка», and only while no intro of the
 * card is on the schedule: to move it, the teacher cancels it and books again
 * (product owner, 2026-11-24). The request is locked first, so two bookings
 * at once make one card and one lesson. Null when there is no such request
 * of this teacher.
 */
export async function bookIntro(
  database: Database,
  teacherId: string,
  id: string,
  intro: { date: string; time: string; durationMinutes: number },
): Promise<"booked" | BookingRefusal | null> {
  const zone = await teacherTimeZone(database, teacherId);
  return database.transaction(async (tx) => {
    const [request] = await tx
      .select({ firstName: clientRequest.firstName, studentId: clientRequest.studentId, stage: clientRequest.stage })
      .from(clientRequest)
      .where(live(teacherId, id))
      .for("update");
    if (!request?.firstName) return null;
    let studentId = request.studentId;
    // The intro on the schedule is named first, whatever the stage.
    if (studentId) {
      const [scheduled] = await tx
        .select({ startsAt: lesson.startsAt })
        .from(lesson)
        .where(and(eq(lesson.studentId, studentId), eq(lesson.teacherId, teacherId), eq(lesson.kind, "intro"), eq(lesson.status, "scheduled")))
        .orderBy(asc(lesson.startsAt))
        .limit(1);
      if (scheduled) return { refused: "scheduled" as const, startsAt: scheduled.startsAt };
    }
    if (request.stage !== "request") return { refused: "stage" as const };
    if (!studentId) {
      const [card] = await tx
        .insert(student)
        .values({ teacherId, firstName: request.firstName, timeZone: zone, status: CANDIDATE_STATUS })
        .returning({ id: student.id });
      if (!card) throw new Error("bookIntro: insert returned no row");
      studentId = card.id;
    }
    await tx.insert(lesson).values({
      teacherId,
      studentId,
      startsAt: zonedMoment(intro.date, intro.time, zone),
      durationMinutes: intro.durationMinutes,
      kind: "intro",
    });
    await tx
      .update(clientRequest)
      .set({ studentId, stage: "intro_booked", declineReason: null, declineComment: null, updatedAt: new Date() })
      .where(live(teacherId, id));
    return "booked" as const;
  });
}

/** The stages an intro lesson moves its request between; a request moved on by hand stays where it is. */
const INTRO_STAGES: RequestStage[] = ["request", "intro_booked", "intro_held"];

/** Whether the request's card has an intro lesson of this status. */
const hasIntro = (teacherId: string, status: "held" | "scheduled") =>
  sql`EXISTS (SELECT 1 FROM ${lesson} AS intro WHERE intro.student_id = ${clientRequest.studentId} AND intro.teacher_id = ${teacherId} AND intro.kind = 'intro' AND intro.status = ${status})`;

/**
 * After an intro lesson is marked, cancelled, put back or finished (#338),
 * its request follows all the card's intro lessons as they are now: one
 * held — «Вводный проведён»; else one scheduled — «Вводный записан»; else
 * (missed or cancelled) — «Заявка». So a cancelled lesson never sends the
 * request back while another intro is on the schedule. Run it in the
 * transaction of the lesson's change, so the two never part. Any other lesson
 * changes nothing.
 */
export async function followIntroLesson(database: Pick<Database, "update">, teacherId: string, lessonId: string): Promise<void> {
  await database
    .update(clientRequest)
    .set({
      stage: sql`CASE WHEN ${hasIntro(teacherId, "held")} THEN 'intro_held' WHEN ${hasIntro(teacherId, "scheduled")} THEN 'intro_booked' ELSE 'request' END`,
      updatedAt: new Date(),
    })
    .from(lesson)
    .where(
      and(
        eq(lesson.id, lessonId),
        eq(lesson.teacherId, teacherId),
        eq(lesson.kind, "intro"),
        eq(clientRequest.studentId, lesson.studentId),
        eq(clientRequest.teacherId, teacherId),
        isNull(clientRequest.deletedAt),
        inArray(clientRequest.stage, INTRO_STAGES),
      ),
    );
}

/** The request of a lesson's hidden card (#338), for «Завершить урок» to go back to; null for any other lesson. */
export async function requestOfLesson(database: Database, teacherId: string, lessonId: string): Promise<string | null> {
  const [row] = await database
    .select({ id: clientRequest.id })
    .from(lesson)
    .innerJoin(clientRequest, and(eq(clientRequest.studentId, lesson.studentId), isNull(clientRequest.deletedAt)))
    .where(and(eq(lesson.id, lessonId), eq(lesson.teacherId, teacherId), eq(clientRequest.teacherId, teacherId)));
  return row?.id ?? null;
}

/** «Итог вводного» (#338): the level and the notes. False when there is no such request of this teacher. */
export async function saveIntroOutcome(
  database: Database,
  teacherId: string,
  id: string,
  outcome: { level: Level | null; notes: string | null },
): Promise<boolean> {
  const rows = await database
    .update(clientRequest)
    .set({ introLevel: outcome.level, introNotes: outcome.notes, updatedAt: new Date() })
    .where(live(teacherId, id))
    .returning({ id: clientRequest.id });
  return rows.length > 0;
}

export type IntroGame = { id: string; title: string; playedAt: Date; answers: { task: string; answer: string; correct: boolean }[] };

/**
 * «Игры на вводном» (#338): the results of the games played on the intro's
 * stage, kept for the hidden card, the newest first. Null when there is no
 * such request of this teacher.
 */
export async function introGames(database: Database, teacherId: string, id: string): Promise<IntroGame[] | null> {
  const [request] = await database.select({ studentId: clientRequest.studentId }).from(clientRequest).where(live(teacherId, id));
  if (!request) return null;
  if (!request.studentId) return [];
  const rows = await database
    .select({ id: gameResult.id, title: gameResult.title, playedAt: gameResult.createdAt, answers: gameResult.answers })
    .from(gameResult)
    .where(and(eq(gameResult.studentId, request.studentId), eq(gameResult.teacherId, teacherId)))
    .orderBy(desc(gameResult.createdAt));
  // Saved through the game result format, so every answer has these fields.
  return rows.map((row) => ({
    ...row,
    answers: (row.answers as { task: string; answer: string; correct: boolean }[]).map(({ task, answer, correct }) => ({ task, answer, correct })),
  }));
}
