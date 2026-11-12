// The router client for client components. Only the router's type is
// imported from the server (AGENTS.md, rule 1).
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@/server/router";

export const routerClient = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: "/api/trpc" })],
});
