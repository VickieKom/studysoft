import { z } from "zod";
import { currentHomeworkForStudent } from "../../homework/homework";
import { router, studentProcedure } from "../core/trpc";

// The student's view of the current homework. No tasks yet (#34), and never a
// key: the schema is strict.
const current = z.object({ dueDate: z.iso.date(), taskCount: z.number().int() }).strict().nullable();

export const studentHomeworkRouter = router({
  current: studentProcedure
    .output(current)
    .query(({ ctx }) => currentHomeworkForStudent(ctx.db, ctx.teacherId, ctx.studentId)),
});
