// The platform client: the application's router, called over HTTPS with the
// teacher's personal token. Only the router's type is imported from the
// application, so a procedure change the server does not follow fails the
// type check (#3).
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "../../app/src/server/router";

export type Platform = ReturnType<typeof createPlatform>;

export function createPlatform(url: string, token: string, fetchImpl?: typeof fetch) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: new URL("/api/trpc", url).toString(),
        headers: { authorization: `Bearer ${token}` },
        ...(fetchImpl ? { fetch: fetchImpl } : {}),
      }),
    ],
  });
}
