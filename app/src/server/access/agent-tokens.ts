// The assistant's personal token (#3; architecture 3.2, 8.1). The MCP server
// on the teacher's computer sends it as "Authorization: Bearer <token>". Only
// its hash is stored; the teacher sees the token once. One active token per
// teacher: creating a new one revokes the old.
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../db/client";
import { agentToken } from "../db/schema";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
// Record use at most once a minute, not on every call.
const TOUCH_INTERVAL_MS = 60 * 1000;

export type AgentTokenStatus = { createdAt: Date; lastUsedAt: Date | null } | null;

/** The teacher's active token, without the token itself. */
export async function agentTokenStatus(db: Database, teacherId: string): Promise<AgentTokenStatus> {
  const [row] = await db
    .select({ createdAt: agentToken.createdAt, lastUsedAt: agentToken.lastUsedAt })
    .from(agentToken)
    .where(and(eq(agentToken.teacherId, teacherId), isNull(agentToken.revokedAt)));
  return row ?? null;
}

/** Revokes the teacher's active token, if any. */
export async function revokeAgentToken(db: Database, teacherId: string): Promise<void> {
  await db
    .update(agentToken)
    .set({ revokedAt: new Date() })
    .where(and(eq(agentToken.teacherId, teacherId), isNull(agentToken.revokedAt)));
}

/** Creates a new token, revoking the old one; returns the token — the only time it exists in clear. */
export async function createAgentToken(db: Database, teacherId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.transaction(async (tx) => {
    await tx
      .update(agentToken)
      .set({ revokedAt: new Date() })
      .where(and(eq(agentToken.teacherId, teacherId), isNull(agentToken.revokedAt)));
    await tx.insert(agentToken).values({ teacherId, tokenHash: sha256(token) });
  });
  return token;
}

function bearer(headers: Headers): string | null {
  const value = headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(value);
  return match?.[1] ?? null;
}

/** The teacher behind an agent token in the request, or null. Records the use. */
export async function teacherIdFromAgentToken(db: Database, headers: Headers): Promise<string | null> {
  const token = bearer(headers);
  if (!token) return null;
  const [row] = await db
    .select({ id: agentToken.id, teacherId: agentToken.teacherId, lastUsedAt: agentToken.lastUsedAt })
    .from(agentToken)
    .where(and(eq(agentToken.tokenHash, sha256(token)), isNull(agentToken.revokedAt)));
  if (!row) return null;
  const now = new Date();
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.update(agentToken).set({ lastUsedAt: now }).where(eq(agentToken.id, row.id));
  }
  return row.teacherId;
}
