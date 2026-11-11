// Base procedures. Every procedure is exactly one kind — public, teacher,
// student, parent or agent — and access is deny-by-default (AGENTS.md, rule 3).
// The student, parent and agent kinds arrive with their slices.
import { initTRPC, TRPCError } from "@trpc/server";
import { teacherIdFromHeaders } from "../../access/auth";
import { db, type Database } from "../../db/client";

export type Context = {
  headers: Headers;
  db: Database;
};

export function createContext(headers: Headers): Context {
  return { headers, db: db() };
}

const t = initTRPC.context<Context>().create({
  // Internal details never reach the client; the code and our own message do.
  errorFormatter({ shape }) {
    const { stack: _stack, ...data } = shape.data;
    return { ...shape, data };
  },
});

export const router = t.router;
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
