import { progressViewSchema } from "../../../domain/progress";
import { progressView } from "../../crm/progress";
import { parentProcedure, router } from "../core/trpc";

// The dashboard on the parent's page (#256): the child's results by skill and
// the totals, as on the teacher's card, and nothing else — no answers,
// recordings, notes or another child's data. The output schema is the guard.
export const parentProgressRouter = router({
  progress: parentProcedure.output(progressViewSchema).query(({ ctx }) => progressView(ctx.db, ctx.teacherId, ctx.studentId)),
});
