import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { MAX_BLOCKS, reportBlockSchema, reportNumbersSchema } from "../../../domain/report";
import { dateIn } from "../../../domain/schedule";
import { balanceLine, findReport, listReports, openDraft, reportNumbers, saveDraft } from "../../crm/reports";
import { findStudent } from "../../crm/students";
import { router, teacherProcedure } from "../core/trpc";

// «Отчёты» on the student card (#267): drafts with the period's numbers and
// the teacher's blocks. The teacher's only: nothing here reaches a student, a
// parent or the assistant; the parent's page gets published reports (#268).

const notFound = () => new TRPCError({ code: "NOT_FOUND" });

const draftView = z
  .object({
    id: z.uuid(),
    firstName: z.string(),
    periodFrom: z.iso.date(),
    periodTo: z.iso.date(),
    blocks: z.array(reportBlockSchema),
    showPayments: z.boolean(),
    numbers: reportNumbersSchema,
    // The balance line «Показать оплаты» adds to the messenger text; never on the parent's page (AGENTS.md, rule 4).
    balance: z.string().nullable(),
  })
  .strict();

export const reportsRouter = router({
  /** The student's reports, the newest period first. */
  list: teacherProcedure
    .input(z.object({ studentId: z.uuid() }))
    .output(
      z.array(
        z.object({ id: z.uuid(), status: z.enum(["draft", "published"]), periodFrom: z.iso.date(), periodTo: z.iso.date() }).strict(),
      ),
    )
    .query(async ({ ctx, input }) => {
      if (!(await findStudent(ctx.db, ctx.teacherId, input.studentId))) throw notFound();
      return (await listReports(ctx.db, ctx.teacherId, input.studentId)).map((r) => ({
        id: r.id,
        status: r.status as "draft" | "published",
        periodFrom: r.periodFrom,
        periodTo: r.periodTo,
      }));
    }),

  /** «Новый отчёт»: the student's draft, a new one when there is none, with the period's numbers. */
  open: teacherProcedure
    .input(z.object({ studentId: z.uuid() }))
    .output(draftView)
    .mutation(async ({ ctx, input }) => {
      const card = await findStudent(ctx.db, ctx.teacherId, input.studentId);
      const draft = card && (await openDraft(ctx.db, ctx.teacherId, input.studentId));
      if (!card || !draft) throw notFound();
      return {
        id: draft.id,
        firstName: card.firstName,
        periodFrom: draft.periodFrom,
        periodTo: draft.periodTo,
        blocks: draft.blocks,
        showPayments: draft.showPayments,
        numbers: await reportNumbers(ctx.db, ctx.teacherId, input.studentId, draft.periodFrom, draft.periodTo, card.timeZone),
        balance: await balanceLine(ctx.db, ctx.teacherId, input.studentId, dateIn(new Date(), card.timeZone)),
      };
    }),

  /** «Сохранить черновик»: the blocks in the teacher's order and «Показать оплаты». */
  save: teacherProcedure
    .input(z.object({ reportId: z.uuid(), blocks: z.array(reportBlockSchema).max(MAX_BLOCKS), showPayments: z.boolean() }))
    .output(z.object({ ok: z.literal(true) }).strict())
    .mutation(async ({ ctx, input }) => {
      const found = await findReport(ctx.db, ctx.teacherId, input.reportId);
      if (!found || found.status !== "draft") throw notFound();
      if (!(await saveDraft(ctx.db, ctx.teacherId, input.reportId, input))) throw notFound();
      return { ok: true as const };
    }),
});
