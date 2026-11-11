import type { AnyRouter } from "@trpc/server";
import type { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createContext } from "./trpc";

/**
 * Logs an unexpected procedure failure as one JSON line with an internal
 * identifier. Expected outcomes (not signed in, not found, bad input) are not
 * errors of the system and are not logged.
 */
export function logProcedureError(error: TRPCError, path: string | undefined): void {
  if (error.code !== "INTERNAL_SERVER_ERROR") return;
  const cause = error.cause ?? error;
  console.error(
    JSON.stringify({
      level: "error",
      event: "procedure_failed",
      errorId: crypto.randomUUID(),
      path: path ?? null,
      // The original text stays on the server: it is what the client no longer sees.
      message: cause instanceof Error ? cause.message : String(cause),
      stack: cause instanceof Error ? cause.stack : undefined,
    }),
  );
}

/** Serves a router over HTTP with the shared context and error logging. */
export function serveRouter(router: AnyRouter, endpoint: string, request: Request): Promise<Response> {
  return fetchRequestHandler({
    endpoint,
    req: request,
    router,
    createContext: () => createContext(request.headers),
    onError: ({ error, path }) => logProcedureError(error, path),
  });
}
