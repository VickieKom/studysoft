// The router entry point: the only server module code outside src/server/ may
// import (AGENTS.md, rule 1). Client components import its types; server
// components and src/app/api/ use the server caller and the request handlers.
import { TRPCError } from "@trpc/server";
import { handleAuthRequest } from "../access/auth";
import { logProcedureError, serveRouter } from "./core/errors";
import { createCallerFactory, createContext, mergeRouters, router } from "./core/trpc";
import { agentStudentsRouter } from "./agent/students";
import { healthRouter } from "./public/health";
import { linksRouter } from "./public/links";
import { studentHomeworkRouter } from "./student/homework";
import { parentMeRouter } from "./parent/me";
import { studentMeRouter } from "./student/me";
import { homeworkRouter } from "./teacher/homework";
import { reviewRouter } from "./teacher/review";
import { linksTeacherRouter } from "./teacher/links";
import { assistantRouter } from "./teacher/assistant";
import { notesRouter } from "./teacher/notes";
import { sessionRouter } from "./teacher/session";
import { studentsRouter } from "./teacher/students";

export const appRouter = router({
  health: healthRouter,
  links: linksRouter,
  student: mergeRouters(studentMeRouter, router({ homework: studentHomeworkRouter })),
  parent: parentMeRouter,
  agent: agentStudentsRouter,
  teacher: router({
    session: sessionRouter,
    students: studentsRouter,
    assistant: assistantRouter,
    notes: notesRouter,
    links: linksTeacherRouter,
    homework: homeworkRouter,
    review: reviewRouter,
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

/** Pictures of homework tasks, served after a permission check (#33). */
export { handleHomeworkImageRequest } from "../homework/images";

/** True when a procedure refused because there is no valid session. */
export function isUnauthorized(error: unknown): boolean {
  return error instanceof TRPCError && error.code === "UNAUTHORIZED";
}

/** True when a procedure answered "not found" — which also covers "not yours". */
export function isNotFound(error: unknown): boolean {
  return error instanceof TRPCError && error.code === "NOT_FOUND";
}
