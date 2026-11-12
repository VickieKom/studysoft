// The router entry point: the only server module code outside src/server/ may
// import (AGENTS.md, rule 1). Client components import its types; server
// components and src/app/api/ use the server caller and the request handlers.
import { TRPCError } from "@trpc/server";
import { handleAuthRequest } from "../access/auth";
import { logProcedureError, serveRouter } from "./core/errors";
import { createCallerFactory, createContext, router } from "./core/trpc";
import { healthRouter } from "./public/health";
import { linksRouter } from "./public/links";
import { parentMeRouter } from "./parent/me";
import { studentMeRouter } from "./student/me";
import { linksTeacherRouter } from "./teacher/links";
import { notesRouter } from "./teacher/notes";
import { sessionRouter } from "./teacher/session";
import { studentsRouter } from "./teacher/students";

export const appRouter = router({
  health: healthRouter,
  links: linksRouter,
  student: studentMeRouter,
  parent: parentMeRouter,
  teacher: router({
    session: sessionRouter,
    students: studentsRouter,
    notes: notesRouter,
    links: linksTeacherRouter,
  }),
});

export type AppRouter = typeof appRouter;

export const ROUTER_ENDPOINT = "/api/trpc";

const createCaller = createCallerFactory(appRouter);

/** Calls procedures in-process with the permissions of the given request headers. */
export function createServerCaller(headers: Headers) {
  return createCaller(createContext(headers), {
    onError: ({ error, path }) => logProcedureError(error, path),
  });
}

/** HTTP entry point for the router. */
export function handleRouterRequest(request: Request): Promise<Response> {
  return serveRouter(appRouter, ROUTER_ENDPOINT, request);
}

export { handleAuthRequest };

/** True when a procedure refused because there is no valid session. */
export function isUnauthorized(error: unknown): boolean {
  return error instanceof TRPCError && error.code === "UNAUTHORIZED";
}

/** True when a procedure answered "not found" — which also covers "not yours". */
export function isNotFound(error: unknown): boolean {
  return error instanceof TRPCError && error.code === "NOT_FOUND";
}
