import { z } from "zod";
import { listStudents } from "../../crm/students";
import { router, teacherProcedure } from "../core/trpc";

const studentSummary = z.object({
  id: z.uuid(),
  displayName: z.string(),
});

export const studentsRouter = router({
  list: teacherProcedure
    .output(z.array(studentSummary))
    .query(({ ctx }) => listStudents(ctx.db, ctx.teacherId)),
});
