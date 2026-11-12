import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { exchangeToken, sessionCookieHeader } from "../../access/links";
import { publicProcedure, router } from "../core/trpc";

export const linksRouter = router({
  // Public: one of the few procedures reachable without a session
  // (architecture 8.1). A revoked, a foreign and a random token all answer
  // NOT_FOUND. Over HTTP only: the session arrives as a cookie.
  exchange: publicProcedure
    .input(z.object({ token: z.string().min(1).max(200) }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      // shortcut: no attempt limit per client address, add with the proxy setup (#54)
      // Without response headers (the server caller) a session could not be
      // handed over, so none is created.
      if (!ctx.resHeaders) throw new TRPCError({ code: "NOT_FOUND" });
      const session = await exchangeToken(ctx.db, input.token);
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      ctx.resHeaders.append("Set-Cookie", sessionCookieHeader(session.cookie));
      return { ok: true as const };
    }),
});
