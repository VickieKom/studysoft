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
//
// Taking a link back (#21): a reissue bumps the generation, which changes the
// token and ends every session of the old generation. Moving a student to
// "Завершили" revokes both links; when the student comes back, the next copy
// reissues them, so the old tokens stay dead.
import { createHash, createHmac, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Database } from "../db/client";
import { accessLink, linkSession, student } from "../db/schema";
import { env } from "../env";

export type LinkRole = "student" | "parent";

// One cookie per role: a family often shares one device, and opening the
// parent link there must not end the child's session, nor the other way round.
export const LINK_SESSION_COOKIES: Record<LinkRole, string> = {
  student: "studysoft_link_student",
  parent: "studysoft_link_parent",
};
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

// Each role has its own route tree: /s for the student, /p for the parent.
const LINK_PATHS: Record<LinkRole, string> = { student: "/s", parent: "/p" };

/** The link's address: the token travels in the fragment, never to a server log. */
export function linkUrl(token: string, role: LinkRole): string {
  return new URL(`${LINK_PATHS[role]}#${token}`, env().APP_URL).toString();
}

type LinkRow = { id: string; generation: number; tokenHash: string; revokedAt: Date | null };

const linkColumns = {
  id: accessLink.id,
  generation: accessLink.generation,
  tokenHash: accessLink.tokenHash,
  revokedAt: accessLink.revokedAt,
};

async function findLink(db: Database, teacherId: string, studentId: string, role: LinkRole): Promise<LinkRow | undefined> {
  const [row] = await db
    .select(linkColumns)
    .from(accessLink)
    .where(and(eq(accessLink.studentId, studentId), eq(accessLink.teacherId, teacherId), eq(accessLink.role, role)));
  return row;
}

/**
 * The link row of a student for a role, created on first use; it may be
 * revoked. Students created before links existed get theirs when the teacher
 * first copies it.
 */
export async function ensureLink(db: Database, teacherId: string, studentId: string, role: LinkRole): Promise<LinkRow> {
  const existing = await findLink(db, teacherId, studentId, role);
  if (existing) return existing;

  const id = crypto.randomUUID();
  const tokenHash = sha256(deriveToken(id, role, 1));
  const [created] = await db
    .insert(accessLink)
    .values({ id, teacherId, studentId, role, generation: 1, tokenHash })
    .onConflictDoNothing({ target: [accessLink.studentId, accessLink.role] })
    .returning(linkColumns);
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
  const found = await ensureLink(db, teacherId, studentId, role);
  // A revoked link belongs to a student who has come back from "Завершили":
  // the card offers a new one. The caller refuses while the student is there.
  const link = found.revokedAt ? await bumpGeneration(db, found, role) : found;
  const token = deriveToken(link.id, role, link.generation);
  const tokenHash = sha256(token);
  if (tokenHash !== link.tokenHash) {
    await db.update(accessLink).set({ tokenHash }).where(eq(accessLink.id, link.id));
  }
  return linkUrl(token, role);
}

/**
 * Moves a link to its next generation in one statement: a new token, no
 * revocation. The old token and every session opened from it stop working.
 * The update is conditional on the generation it started from: if another
 * request changed the link meanwhile, its result stands when it is a fresh,
 * open link, and nothing is undone otherwise (a revocation wins).
 */
async function bumpGeneration(db: Database, link: LinkRow, role: LinkRole): Promise<LinkRow> {
  const generation = link.generation + 1;
  const [next] = await db
    .update(accessLink)
    .set({ generation, tokenHash: sha256(deriveToken(link.id, role, generation)), revokedAt: null })
    .where(and(eq(accessLink.id, link.id), eq(accessLink.generation, link.generation)))
    .returning(linkColumns);
  if (next) return next;
  const [reread] = await db.select(linkColumns).from(accessLink).where(eq(accessLink.id, link.id));
  if (reread && !reread.revokedAt && reread.generation > link.generation) return reread;
  throw new Error("bumpGeneration: the link changed meanwhile");
}

/** "Перевыпустить": the student's or the parent's link gets a new token (#21). */
export async function reissueLink(db: Database, teacherId: string, studentId: string, role: LinkRole): Promise<void> {
  await bumpGeneration(db, await ensureLink(db, teacherId, studentId, role), role);
}

/** Closes both links of a student and every session opened from them (#21, "Завершили"). */
export async function revokeLinks(db: Database, teacherId: string, studentId: string): Promise<void> {
  await db
    .update(accessLink)
    .set({ revokedAt: new Date() })
    .where(and(eq(accessLink.studentId, studentId), eq(accessLink.teacherId, teacherId), isNull(accessLink.revokedAt)));
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

export function sessionCookieHeader(value: string, role: LinkRole): string {
  const secure = env().APP_URL.startsWith("https:") ? "; Secure" : "";
  return `${LINK_SESSION_COOKIES[role]}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE_SECONDS}${secure}`;
}

function cookieFrom(headers: Headers, cookieName: string): string | null {
  for (const part of (headers.get("cookie") ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === cookieName) return rest.join("=") || null;
  }
  return null;
}

/**
 * Who the session of one role belongs to, or null. Only that role's cookie is
 * read, and the link must be of that role. A session is valid while it has not
 * expired, its link is not revoked, its generation is the link's current one,
 * and the student is not deleted. A valid session is extended.
 */
export async function linkSessionFromHeaders(
  db: Database,
  headers: Headers,
  role: LinkRole,
): Promise<{ role: LinkRole; studentId: string; teacherId: string } | null> {
  const cookie = cookieFrom(headers, LINK_SESSION_COOKIES[role]);
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
      and(
        eq(accessLink.id, linkSession.linkId),
        eq(accessLink.role, role),
        eq(accessLink.generation, linkSession.generation),
        isNull(accessLink.revokedAt),
      ),
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
