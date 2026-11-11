import { z } from "zod";
import { isDatabaseReachable } from "../../db/client";
import { env } from "../../env";
import { publicProcedure, router } from "../core/trpc";

export const healthOutput = z.object({
  database: z.enum(["ok", "unavailable"]),
  build: z.string(),
});

export const healthRouter = router({
  // Public: monitoring probes it without a session. It reveals only whether
  // the database answers and which build is running.
  check: publicProcedure.output(healthOutput).query(async () => ({
    database: (await isDatabaseReachable()) ? "ok" : "unavailable",
    build: env().BUILD_SHA,
  })),
});
