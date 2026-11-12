import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { currentLinkUrl, type LinkRole, reissueLink } from "../../access/links";
import { findStudent } from "../../crm/students";
import type { Database } from "../../db/client";
import { router, teacherProcedure } from "../core/trpc";

/**
 * The student must be this teacher's and not in "Завершили": a finished
 * student's links are closed, and the card offers none (#21).
 */
async function studentWithOpenAccess(db: Database, teacherId: string, studentId: string) {
  const card = await findStudent(db, teacherId, studentId);
  if (!card) throw new TRPCError({ code: "NOT_FOUND" });
  if (card.status === "finished") throw new TRPCError({ code: "PRECONDITION_FAILED" });
}

const linkQuery = (role: LinkRole) =>
  teacherProcedure
    .input(z.object({ studentId: z.uuid() }))
    .output(z.object({ url: z.url() }))
    .query(async ({ ctx, input }) => {
      await studentWithOpenAccess(ctx.db, ctx.teacherId, input.studentId);
      return { url: await currentLinkUrl(ctx.db, ctx.teacherId, input.studentId, role) };
    });

export const linksTeacherRouter = router({
  /** The student's permanent link; copying it never changes it. */
  student: linkQuery("student"),

  /** The parent's permanent link: separate from the student's, with its own rights (#20). */
  parent: linkQuery("parent"),

  /** "Перевыпустить": a new link for one role; the old one and its sessions stop working (#21). */
  reissue: teacherProcedure
    .input(z.object({ studentId: z.uuid(), role: z.enum(["student", "parent"]) }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      await studentWithOpenAccess(ctx.db, ctx.teacherId, input.studentId);
      await reissueLink(ctx.db, ctx.teacherId, input.studentId, input.role);
      return { ok: true as const };
    }),
});
