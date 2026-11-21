import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { MAX_BLOCKS, reportBlockSchema, reportNumbersSchema } from "../../../domain/report";
import { dateIn } from "../../../domain/schedule";
import type { Database } from "../../db/client";
import {
  balanceLine,
  findReport,
  listReports,
  openDraft,
  publishReport,
  type ReportRow,
  recordingUrls,
  reportNumbers,
  saveReport,
  unpublishReport,
} from "../../crm/reports";
import { findStudent } from "../../crm/students";
import { router, teacherProcedure } from "../core/trpc";

// «Отчёты» on the student card: drafts with the period's numbers and the
// teacher's blocks (#267), publishing to the parent's page, editing a
// published one and taking it down (#268). The teacher's only: the parent's
// page gets published reports through `parent.reports`, never the balance.

const notFound = () => new TRPCError({ code: "NOT_FOUND" });
const status = z.enum(["draft", "published"]);

const reportView = z
  .object({
    id: z.uuid(),
    status,
    firstName: z.string(),
    periodFrom: z.iso.date(),
    periodTo: z.iso.date(),
    blocks: z.array(reportBlockSchema),
    showPayments: z.boolean(),
    numbers: reportNumbersSchema,
    // The balance line «Показать оплаты» adds to the messenger text; never on the parent's page (AGENTS.md, rule 4).
    balance: z.string().nullable(),
    recordings: z.object({ before: z.string().nullable(), after: z.string().nullable() }).strict(),
  })
  .strict();

/** A report as the card shows it: the frozen numbers once published, else counted now. */
async function view(db: Database, teacherId: string, studentId: string, found: ReportRow) {
  const card = await findStudent(db, teacherId, studentId);
  if (!card) throw notFound();
  return {
    id: found.id,
    status: found.status as "draft" | "published",
    firstName: card.firstName,
    periodFrom: found.periodFrom,
    periodTo: found.periodTo,
    blocks: found.blocks,
    showPayments: found.showPayments,
    numbers: found.numbers ?? (await reportNumbers(db, teacherId, studentId, found.periodFrom, found.periodTo, card.timeZone)),
    balance: await balanceLine(db, teacherId, studentId, dateIn(new Date(), card.timeZone)),
    recordings: recordingUrls(found),
  };
}

const reportId = z.object({ reportId: z.uuid() });
const ok = z.object({ ok: z.literal(true) }).strict();

export const reportsRouter = router({
  /** The student's reports, the newest period first. */
  list: teacherProcedure
    .input(z.object({ studentId: z.uuid() }))
    .output(z.array(z.object({ id: z.uuid(), status, periodFrom: z.iso.date(), periodTo: z.iso.date() }).strict()))
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
    .output(reportView)
    .mutation(async ({ ctx, input }) => {
      const draft = await openDraft(ctx.db, ctx.teacherId, input.studentId);
      if (!draft) throw notFound();
      return view(ctx.db, ctx.teacherId, input.studentId, draft);
    }),

  /** «Открыть»: one report of the list. */
  get: teacherProcedure
    .input(reportId)
    .output(reportView)
    .query(async ({ ctx, input }) => {
      const found = await findReport(ctx.db, ctx.teacherId, input.reportId);
      if (!found) throw notFound();
      return view(ctx.db, ctx.teacherId, found.studentId, found);
    }),

  /** «Сохранить»: the blocks in the teacher's order and «Показать оплаты», of a draft or a published report. */
  save: teacherProcedure
    .input(z.object({ reportId: z.uuid(), blocks: z.array(reportBlockSchema).max(MAX_BLOCKS), showPayments: z.boolean() }))
    .output(ok)
    .mutation(async ({ ctx, input }) => {
      if (!(await saveReport(ctx.db, ctx.teacherId, input.reportId, input))) throw notFound();
      return { ok: true as const };
    }),

  /** «Опубликовать»: the draft goes to the parent's page; its numbers freeze. */
  publish: teacherProcedure
    .input(reportId)
    .output(ok)
    .mutation(async ({ ctx, input }) => {
      if (!(await publishReport(ctx.db, ctx.teacherId, input.reportId))) throw notFound();
      return { ok: true as const };
    }),

  /** «Снять с публикации»: a draft again, off the parent's page; refused while the student has another draft. */
  unpublish: teacherProcedure
    .input(reportId)
    .output(ok)
    .mutation(async ({ ctx, input }) => {
      const result = await unpublishReport(ctx.db, ctx.teacherId, input.reportId);
      if (result === "not_found") throw notFound();
      if (result === "draft_exists") throw new TRPCError({ code: "CONFLICT", message: "Сначала опубликуйте черновик этого ученика" });
      return { ok: true as const };
    }),
});
