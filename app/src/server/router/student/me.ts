import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { studentPageView } from "../../crm/students";
import { router, studentProcedure } from "../core/trpc";

// What the student page shows about the student. The output schema has no
// last name, contacts or anything else of the card (#18, #19).
const studentView = z.object({ firstName: z.string() }).strict();

export const studentMeRouter = router({
  me: studentProcedure.output(studentView).query(async ({ ctx }) => {
    const view = await studentPageView(ctx.db, ctx.teacherId, ctx.studentId);
    if (!view) throw new TRPCError({ code: "UNAUTHORIZED" });
    return view;
  }),
});
