import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { LEVELS, STATUSES } from "../../../domain/student";
import { buildStudentContext } from "../../crm/context";
import { listStudents } from "../../crm/students";
import { agentProcedure, router } from "../core/trpc";

// What the assistant sees. Strict schemas: a field added to the card does not
// reach the assistant unless it is added here on purpose (#3, #18).
const studentEntry = z.object({ id: z.uuid(), firstName: z.string(), status: z.enum(STATUSES) }).strict();

const studentContext = z
  .object({
    firstName: z.string(),
    age: z.string().nullable(),
    schoolYear: z.string().nullable(),
    level: z.enum(LEVELS),
    textbook: z.string().nullable(),
    currentUnit: z.string().nullable(),
    interests: z.string().nullable(),
    whatWorks: z.string().nullable(),
    gaps: z.string().nullable(),
    notes: z.array(z.object({ body: z.string(), createdAt: z.iso.datetime() }).strict()),
  })
  .strict();

export const agentStudentsRouter = router({
  /** Every student of the teacher, archive included, with the status to tell them apart. */
  listStudents: agentProcedure.output(z.array(studentEntry)).query(async ({ ctx }) =>
    (await listStudents(ctx.db, ctx.teacherId, STATUSES)).map((s) => ({
      id: s.id,
      firstName: s.firstName,
      status: s.status,
    })),
  ),

  studentContext: agentProcedure
    .input(z.object({ studentId: z.uuid() }))
    .output(studentContext)
    .query(async ({ ctx, input }) => {
      const context = await buildStudentContext(ctx.db, ctx.teacherId, input.studentId);
      if (!context) throw new TRPCError({ code: "NOT_FOUND" });
      return {
        ...context,
        level: context.level as (typeof LEVELS)[number],
        notes: context.notes.map((note) => ({ body: note.body, createdAt: note.createdAt.toISOString() })),
      };
    }),
});
