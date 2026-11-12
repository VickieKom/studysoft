import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { studentPageView } from "../../crm/students";
import { parentProcedure, router } from "../core/trpc";

// What the parent page shows about the child. The output schema has only the
// first name: never the last name, contacts or anything else of the card
// (#18, #20).
const childView = z.object({ firstName: z.string() }).strict();

export const parentMeRouter = router({
  me: parentProcedure.output(childView).query(async ({ ctx }) => {
    const view = await studentPageView(ctx.db, ctx.teacherId, ctx.studentId);
    if (!view) throw new TRPCError({ code: "UNAUTHORIZED" });
    return view;
  }),
});
