// Teacher sign-in through the authentication library (decision 5 in
// docs/architecture.md). Password hashing, sessions and attempt limiting are
// the library's; this module only configures it and narrows what it exposes.
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db/client";
import * as schema from "../db/schema";
import { env } from "../env";

const AUTH_BASE_PATH = "/api/auth";

// The only library endpoints reachable over HTTP. Everything else it offers
// (registration, password reset, account linking, profile changes) answers 404
// until a task needs it. An allow-list, so a library update adds nothing.
const EXPOSED_PATHS = new Set(["/sign-in/email", "/sign-out"]);

function createAuth() {
  const { AUTH_SECRET, APP_URL } = env();
  return betterAuth({
    secret: AUTH_SECRET,
    baseURL: APP_URL,
    basePath: AUTH_BASE_PATH,
    trustedOrigins: [APP_URL],
    database: drizzleAdapter(db(), {
      provider: "pg",
      schema: {
        teacher: schema.teacher,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    user: { modelName: "teacher" },
    session: { fields: { userId: "teacherId" } },
    account: { fields: { userId: "teacherId" } },
    // Teachers are created by the operator; there is no registration.
    emailAndPassword: { enabled: true, disableSignUp: true },
    advanced: { database: { generateId: "uuid" } },
    // shortcut: in-memory limit, resets on restart; move to the database store before a second app process (#4)
    rateLimit: { enabled: true, storage: "memory" },
    telemetry: { enabled: false },
  });
}

type Auth = ReturnType<typeof createAuth>;

const holder = globalThis as unknown as { studysoftAuth?: Auth };

export function auth(): Auth {
  holder.studysoftAuth ??= createAuth();
  return holder.studysoftAuth;
}

/** HTTP entry point for sign-in and sign-out; every other path is 404. */
export async function handleAuthRequest(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname.slice(AUTH_BASE_PATH.length);
  if (!EXPOSED_PATHS.has(path)) {
    return new Response(null, { status: 404 });
  }
  return auth().handler(request);
}

/** The signed-in teacher's identifier, or null. Taken from the session only. */
export async function teacherIdFromHeaders(headers: Headers): Promise<string | null> {
  const result = await auth().api.getSession({ headers });
  return result?.user.id ?? null;
}
