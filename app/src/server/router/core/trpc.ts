// Base procedures. Every procedure is exactly one kind — public, teacher,
// student, parent or agent — and access is deny-by-default (AGENTS.md, rule 3).
import { initTRPC, TRPCError } from "@trpc/server";
import { teacherIdFromAgentToken } from "../../access/agent-tokens";
import { teacherIdFromHeaders } from "../../access/auth";
import { linkSessionFromHeaders } from "../../access/links";
import { db, type Database } from "../../db/client";

export type Context = {
  headers: Headers;
  db: Database;
  /** Response headers over HTTP (to set a cookie); absent for the server caller. */
  resHeaders?: Headers;
};

export function createContext(headers: Headers, resHeaders?: Headers): Context {
  return { headers, db: db(), resHeaders };
}

export const INTERNAL_ERROR_MESSAGE = "Internal server error";

const t = initTRPC.context<Context>().create({
  // Internal details never reach the client. An unexpected error (a driver
  // failure, a bug) carries its original text, which can name tables, columns
  // or values; the client gets a generic message and the original is logged
  // (core/errors.ts). Errors we throw on purpose keep their code and message.
  errorFormatter({ shape, error }) {
    const { stack: _stack, ...data } = shape.data;
    const message = error.code === "INTERNAL_SERVER_ERROR" ? INTERNAL_ERROR_MESSAGE : shape.message;
    return { ...shape, message, data };
  },
});

export const router = t.router;
export const mergeRouters = t.mergeRouters;
export const createCallerFactory = t.createCallerFactory;

/** Reachable without a session. Adding one is a guarded change. */
export const publicProcedure = t.procedure;

/** Requires a teacher session. The teacher identifier comes from it, never from input. */
export const teacherProcedure = t.procedure.use(async ({ ctx, next }) => {
  const teacherId = await teacherIdFromHeaders(ctx.headers);
  if (!teacherId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, teacherId } });
});

/**
 * Requires a session opened from a student link (#19). The student and the
 * teacher come from the session, never from input. A parent session is not
 * a student session.
 */
export const studentProcedure = t.procedure.use(async ({ ctx, next }) => {
  const session = await linkSessionFromHeaders(ctx.db, ctx.headers, "student");
  if (!session || session.role !== "student") {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, studentId: session.studentId, teacherId: session.teacherId } });
});

/**
 * Requires a session opened from a parent link (#20): read only. The child and
 * the teacher come from the session, never from input. A student session is
 * not a parent session.
 */
export const parentProcedure = t.procedure.use(async ({ ctx, next }) => {
  const session = await linkSessionFromHeaders(ctx.db, ctx.headers, "parent");
  if (!session || session.role !== "parent") {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, studentId: session.studentId, teacherId: session.teacherId } });
});

/**
 * Requires the assistant's personal token (#3). The teacher comes from the
 * token, never from input. Agent procedures read, and later only create
 * drafts; publishing stays a teacher procedure (AGENTS.md, rule 5).
 */
export const agentProcedure = t.procedure.use(async ({ ctx, next }) => {
  const teacherId = await teacherIdFromAgentToken(ctx.db, ctx.headers);
  if (!teacherId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, teacherId } });
});
