import { z } from "zod";
import { agentTokenStatus, createAgentToken, revokeAgentToken } from "../../access/agent-tokens";
import { router, teacherProcedure } from "../core/trpc";

const status = z
  .object({ createdAt: z.iso.datetime(), lastUsedAt: z.iso.datetime().nullable() })
  .nullable();

export const assistantRouter = router({
  /** Whether the teacher has an active token, and when it was created and last used. */
  status: teacherProcedure.output(status).query(async ({ ctx }) => {
    const current = await agentTokenStatus(ctx.db, ctx.teacherId);
    return current
      ? { createdAt: current.createdAt.toISOString(), lastUsedAt: current.lastUsedAt?.toISOString() ?? null }
      : null;
  }),

  /** A new token, shown once; the previous one stops working. */
  createToken: teacherProcedure
    .output(z.object({ token: z.string() }))
    .mutation(async ({ ctx }) => ({ token: await createAgentToken(ctx.db, ctx.teacherId) })),

  revokeToken: teacherProcedure.output(z.object({ ok: z.literal(true) })).mutation(async ({ ctx }) => {
    await revokeAgentToken(ctx.db, ctx.teacherId);
    return { ok: true as const };
  }),
});
