import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { findTeacher } from "../../access/teachers";
import { router, teacherProcedure } from "../core/trpc";

export const sessionRouter = router({
  /** The signed-in teacher. Fails with UNAUTHORIZED without a session. */
  me: teacherProcedure.output(z.object({ id: z.uuid(), name: z.string() })).query(async ({ ctx }) => {
    const profile = await findTeacher(ctx.db, ctx.teacherId);
    if (!profile) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    return profile;
  }),
});
