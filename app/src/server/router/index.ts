// The router entry point: the only server module code outside src/server/ may
// import (AGENTS.md, rule 1). Client components import its types; server
// components and src/app/api/ use the server caller and the request handlers.
import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { handleAuthRequest } from "../access/auth";
import { createCallerFactory, createContext, router } from "./core/trpc";
import { healthRouter } from "./public/health";
import { sessionRouter } from "./teacher/session";
import { studentsRouter } from "./teacher/students";

export const appRouter = router({
  health: healthRouter,
  teacher: router({
    session: sessionRouter,
    students: studentsRouter,
  }),
});

export type AppRouter = typeof appRouter;

export const ROUTER_ENDPOINT = "/api/trpc";

const createCaller = createCallerFactory(appRouter);

/** Calls procedures in-process with the permissions of the given request headers. */
export function createServerCaller(headers: Headers) {
  return createCaller(createContext(headers));
}

/** HTTP entry point for the router. */
export function handleRouterRequest(request: Request): Promise<Response> {
  return fetchRequestHandler({
    endpoint: ROUTER_ENDPOINT,
    req: request,
    router: appRouter,
    createContext: () => createContext(request.headers),
  });
}

export { handleAuthRequest };

/** True when a procedure refused because there is no valid session. */
export function isUnauthorized(error: unknown): boolean {
  return error instanceof TRPCError && error.code === "UNAUTHORIZED";
}
