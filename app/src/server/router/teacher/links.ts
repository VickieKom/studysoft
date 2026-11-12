import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { currentLinkUrl, type LinkRole, reissueLink, withOpenStudent } from "../../access/links";
import { router, teacherProcedure } from "../core/trpc";

/**
 * The student must be this teacher's and not in "Завершили": a finished
 * student's links are closed, and the card offers none (#21). The status is
 * read in the same transaction as the link, so «Завершили» cannot land in
 * between (#65).
 */
function openOnly<T>(result: T | "missing" | "finished"): T {
  if (result === "missing") throw new TRPCError({ code: "NOT_FOUND" });
  if (result === "finished") throw new TRPCError({ code: "PRECONDITION_FAILED" });
  return result;
}

const linkQuery = (role: LinkRole) =>
  teacherProcedure
    .input(z.object({ studentId: z.uuid() }))
    .output(z.object({ url: z.url() }))
    .query(async ({ ctx, input }) => ({
      url: openOnly(
        await withOpenStudent(ctx.db, ctx.teacherId, input.studentId, (tx) =>
          currentLinkUrl(tx, ctx.teacherId, input.studentId, role),
        ),
      ),
    }));

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
      openOnly(
        await withOpenStudent(ctx.db, ctx.teacherId, input.studentId, (tx) =>
          reissueLink(tx, ctx.teacherId, input.studentId, input.role),
        ),
      );
      return { ok: true as const };
    }),
});
