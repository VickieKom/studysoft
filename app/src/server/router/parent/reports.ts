import { z } from "zod";
import { reportBlockSchema, reportNumbersSchema } from "../../../domain/report";
import { publishedReports } from "../../crm/reports";
import { parentProcedure, router } from "../core/trpc";

// Published reports on the parent's page (#268): the period, the numbers
// frozen at publishing and the filled blocks, newest first — never a draft,
// the balance line (AGENTS.md, rule 4) or another child's report. The output
// schema is the guard.
export const parentReportsRouter = router({
  reports: parentProcedure
    .output(
      z.array(
        z
          .object({ id: z.uuid(), periodFrom: z.iso.date(), periodTo: z.iso.date(), numbers: reportNumbersSchema, blocks: z.array(reportBlockSchema) })
          .strict(),
      ),
    )
    .query(({ ctx }) => publishedReports(ctx.db, ctx.teacherId, ctx.studentId)),
});
