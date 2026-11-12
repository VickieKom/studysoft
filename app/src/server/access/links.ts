// Student and parent links (#19; architecture 8.1).
//
// The token is derived, not stored: HMAC(LINK_KEY, link id ‖ role ‖
// generation). The card recomputes the same link on every copy; the database
// keeps only the token's hash, for the lookup on exchange. A database leak
// without the key yields no working link. Rotating LINK_KEY invalidates every
// link at once. A reissue (#21) bumps the generation.
//
// Opening a link exchanges the token for a session: a random cookie value
// whose hash is stored with the link's generation. Sessions slide: each visit
// moves the expiry forward.
import { createHash, createHmac, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Database } from "../db/client";
import { accessLink, linkSession, student } from "../db/schema";
import { env } from "../env";

export type LinkRole = "student" | "parent";

export const LINK_SESSION_COOKIE = "studysoft_link";
const SESSION_DAYS = 90;
// The browser keeps the cookie longer than the session lives; the server
// decides when a session is over.
const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
// Extend the session at most once an hour, not on every request.
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function deriveToken(linkId: string, role: LinkRole, generation: number): string {
  return createHmac("sha256", env().LINK_KEY).update(`${linkId}|${role}|${generation}`).digest("base64url");
}

/** The link's address: the token travels in the fragment, never to a server log. */
export function linkUrl(token: string): string {
  return new URL(`/s#${token}`, env().APP_URL).toString();
}

/**
 * The current link of a student for a role, issued on first use. Students
 * created before links existed get theirs when the teacher first copies it.
 */
type LinkRow = { id: string; generation: number; tokenHash: string };

async function findLink(db: Database, teacherId: string, studentId: string, role: LinkRole): Promise<LinkRow | undefined> {
  const [row] = await db
    .select({ id: accessLink.id, generation: accessLink.generation, tokenHash: accessLink.tokenHash })
    .from(accessLink)
    .where(and(eq(accessLink.studentId, studentId), eq(accessLink.teacherId, teacherId), eq(accessLink.role, role)));
  return row;
}

// Revocation (revoked_at) is not handled here yet: #21 brings it.
export async function ensureLink(db: Database, teacherId: string, studentId: string, role: LinkRole): Promise<LinkRow> {
  const existing = await findLink(db, teacherId, studentId, role);
  if (existing) return existing;

  const id = crypto.randomUUID();
  const tokenHash = sha256(deriveToken(id, role, 1));
  const [created] = await db
    .insert(accessLink)
    .values({ id, teacherId, studentId, role, generation: 1, tokenHash })
    .onConflictDoNothing({ target: [accessLink.studentId, accessLink.role] })
    .returning({ id: accessLink.id, generation: accessLink.generation, tokenHash: accessLink.tokenHash });
  if (created) return created;
  // Two copies at once: the other request won the insert. Read it once; if
  // it is still not this teacher's, the caller asked for someone else's student.
  const winner = await findLink(db, teacherId, studentId, role);
  if (!winner) throw new Error("ensureLink: the link belongs to another teacher");
  return winner;
}

/**
 * The address of a student's current link for a role. After LINK_KEY is
 * rotated, the stored hash belongs to the old token: it is replaced here, so
 * the card copies a working link again. Old tokens stop working, which is the
 * point of rotating; sessions survive, because they are bound to the
 * generation, not to the token.
 */
export async function currentLinkUrl(db: Database, teacherId: string, studentId: string, role: LinkRole): Promise<string> {
  const link = await ensureLink(db, teacherId, studentId, role);
  const token = deriveToken(link.id, role, link.generation);
  const tokenHash = sha256(token);
  if (tokenHash !== link.tokenHash) {
    await db.update(accessLink).set({ tokenHash }).where(eq(accessLink.id, link.id));
  }
  return linkUrl(token);
}

/**
 * Exchanges a link token for a new session. Returns the cookie value, or null
 * when the token is unknown, revoked or belongs to a deleted student — all
 * three look the same to the caller.
 */
export async function exchangeToken(db: Database, token: string): Promise<{ cookie: string; role: LinkRole } | null> {
  const [link] = await db
    .select({ id: accessLink.id, role: accessLink.role, generation: accessLink.generation })
    .from(accessLink)
    .innerJoin(student, and(eq(student.id, accessLink.studentId), isNull(student.deletedAt)))
    .where(and(eq(accessLink.tokenHash, sha256(token)), isNull(accessLink.revokedAt)));
  if (!link) return null;

  const cookie = randomBytes(32).toString("base64url");
  await db.insert(linkSession).values({
    linkId: link.id,
    generation: link.generation,
    tokenHash: sha256(cookie),
    expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
  });
  return { cookie, role: link.role as LinkRole };
}

export function sessionCookieHeader(value: string): string {
  const secure = env().APP_URL.startsWith("https:") ? "; Secure" : "";
  return `${LINK_SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE_SECONDS}${secure}`;
}

function cookieFrom(headers: Headers): string | null {
  for (const part of (headers.get("cookie") ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === LINK_SESSION_COOKIE) return rest.join("=") || null;
  }
  return null;
}

/**
 * Who a link session belongs to, or null. A session is valid while it has not
 * expired, its link is not revoked, its generation is the link's current one,
 * and the student is not deleted. A valid session is extended.
 */
export async function linkSessionFromHeaders(
  db: Database,
  headers: Headers,
): Promise<{ role: LinkRole; studentId: string; teacherId: string } | null> {
  const cookie = cookieFrom(headers);
  if (!cookie) return null;

  const now = new Date();
  const [row] = await db
    .select({
      sessionId: linkSession.id,
      lastSeenAt: linkSession.lastSeenAt,
      role: accessLink.role,
      studentId: accessLink.studentId,
      teacherId: accessLink.teacherId,
    })
    .from(linkSession)
    .innerJoin(
      accessLink,
      and(eq(accessLink.id, linkSession.linkId), eq(accessLink.generation, linkSession.generation), isNull(accessLink.revokedAt)),
    )
    .innerJoin(student, and(eq(student.id, accessLink.studentId), isNull(student.deletedAt)))
    .where(and(eq(linkSession.tokenHash, sha256(cookie)), gt(linkSession.expiresAt, now)));
  if (!row) return null;

  if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db
      .update(linkSession)
      .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000) })
      .where(eq(linkSession.id, row.sessionId));
  }
  return { role: row.role as LinkRole, studentId: row.studentId, teacherId: row.teacherId };
}
