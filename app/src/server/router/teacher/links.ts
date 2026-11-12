import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { currentLinkUrl } from "../../access/links";
import { findStudent } from "../../crm/students";
import { router, teacherProcedure } from "../core/trpc";

export const linksTeacherRouter = router({
  /** The student's permanent link; copying it never changes it. */
  student: teacherProcedure
    .input(z.object({ studentId: z.uuid() }))
    .output(z.object({ url: z.url() }))
    .query(async ({ ctx, input }) => {
      if (!(await findStudent(ctx.db, ctx.teacherId, input.studentId))) throw new TRPCError({ code: "NOT_FOUND" });
      return { url: await currentLinkUrl(ctx.db, ctx.teacherId, input.studentId, "student") };
    }),

  /** The parent's permanent link: separate from the student's, with its own rights (#20). */
  parent: teacherProcedure
    .input(z.object({ studentId: z.uuid() }))
    .output(z.object({ url: z.url() }))
    .query(async ({ ctx, input }) => {
      if (!(await findStudent(ctx.db, ctx.teacherId, input.studentId))) throw new TRPCError({ code: "NOT_FOUND" });
      return { url: await currentLinkUrl(ctx.db, ctx.teacherId, input.studentId, "parent") };
    }),
});
