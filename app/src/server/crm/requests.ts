// «Привлечение клиентов» (#337): the requests of families who may become
// students, by stage. The teacher adds one, moves it to any stage forward or
// back — «Отказ» with a reason and an optional comment, cleared when it
// leaves «Отказ» — and deletes it. A deleted request keeps no name, age,
// school year, contact or comment: only its stage, source, reason and date,
// as an anonymous count for the metrics (#341). The teacher's only.
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { DeclineReason, RequestSource, RequestStage } from "../../domain/requests";
import type { Database } from "../db/client";
import { clientRequest, clientRequestBrief } from "../db/schema";

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
      .set({ firstName: null, age: null, schoolYear: null, contact: null, declineComment: null, deletedAt: new Date(), updatedAt: new Date() })
      .where(live(teacherId, id))
      .returning({ id: clientRequest.id });
    if (rows.length === 0) return false;
    // The brief is the family's own words (#339): it goes with the rest.
    await tx.delete(clientRequestBrief).where(eq(clientRequestBrief.requestId, id));
    return true;
  });
}

/** One request of this teacher that is not deleted, for its page (#339); null when there is none. */
export async function findRequest(database: Database, teacherId: string, id: string): Promise<ClientRequest | null> {
  const [row] = await database.select(columns).from(clientRequest).where(live(teacherId, id));
  return (row as ClientRequest | undefined) ?? null;
}
