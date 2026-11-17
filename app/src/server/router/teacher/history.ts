import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { findStudent } from "../../crm/students";
import { findImported, importHistory, listImported } from "../../homework/history";
import { router, teacherProcedure } from "../core/trpc";

const notFound = () => new TRPCError({ code: "NOT_FOUND" });
const count = z.number().int().min(0);

// Months of results fit easily; a file this big is not a history export.
const MAX_HISTORY_LENGTH = 5_000_000;

const summary = z
  .object({
    id: z.uuid(),
    studentId: z.uuid(),
    studentName: z.string(),
    title: z.string(),
    submittedOn: z.iso.date(),
    correct: count,
    wrong: count,
    unchecked: count,
  })
  .strict();

/** The results history from the teacher's old tool (#38). */
export const historyRouter = router({
  /** Imports the CSV; the summary says how many submissions came in, how many were there already, and what was skipped. */
  import: teacherProcedure
    .input(z.object({ csv: z.string().max(MAX_HISTORY_LENGTH) }))
    .output(z.object({ imported: count, existing: count, errors: z.array(z.string()) }).strict())
    .mutation(({ ctx, input }) => importHistory(ctx.db, ctx.teacherId, input.csv)),

  /** The imported submissions, newest first; one student's when given. */
  list: teacherProcedure
    .input(z.object({ studentId: z.uuid().nullable() }))
    .output(z.array(summary))
    .query(async ({ ctx, input }) => {
      if (input.studentId && !(await findStudent(ctx.db, ctx.teacherId, input.studentId))) throw notFound();
      return listImported(ctx.db, ctx.teacherId, input.studentId);
    }),

  /** One imported submission with its answers, read-only. */
  get: teacherProcedure
    .input(z.object({ id: z.uuid() }))
    .output(
      summary.extend({
        tasks: z.array(
          z
            .object({
              number: count,
              type: z.string(),
              question: z.string(),
              answer: z.string().nullable(),
              correctAnswer: z.string().nullable(),
              correct: z.boolean().nullable(),
              topic: z.string().nullable(),
            })
            .strict(),
        ),
      }),
    )
    .query(async ({ ctx, input }) => {
      const found = await findImported(ctx.db, ctx.teacherId, input.id);
      if (!found) throw notFound();
      return found;
    }),
});
