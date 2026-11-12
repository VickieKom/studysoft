import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { findStudent } from "../../crm/students";
import {
  findSubmission,
  listReview,
  markOpened,
  markTask,
  reopenHomework,
  saveComment,
  waitingCount,
} from "../../homework/review";
import { router, teacherProcedure } from "../core/trpc";

// «Проверка домашек» (#36). Every procedure is the teacher's own: another
// teacher's submission answers like a missing one.

const notFound = () => new TRPCError({ code: "NOT_FOUND" });
const count = z.number().int();

const row = z
  .object({
    homeworkId: z.uuid(),
    submissionId: z.uuid().nullable(),
    title: z.string(),
    studentName: z.string(),
    date: z.iso.datetime().nullable(),
    correct: count.nullable(),
    wrong: count.nullable(),
    pending: count.nullable(),
    waiting: z.boolean(),
    missed: z.boolean(),
  })
  .strict();

const submission = z
  .object({
    id: z.uuid(),
    homeworkId: z.uuid(),
    title: z.string(),
    studentName: z.string(),
    attempt: count,
    isCurrent: z.boolean(),
    canReopen: z.boolean(),
    submittedAt: z.iso.datetime(),
    correct: count,
    wrong: count,
    pending: count,
    comment: z.string(),
    tasks: z.array(
      z
        .object({
          index: count,
          type: z.string(),
          prompt: z.string(),
          topic: z.string().nullable(),
          answer: z.string().nullable(),
          autoChecked: z.boolean(),
          verdict: z.boolean().nullable(),
          marked: z.boolean().nullable(),
          key: z.string().nullable(),
        })
        .strict(),
    ),
    mistakesByTopic: z.array(z.object({ topic: z.string(), count }).strict()),
    attempts: z.array(
      z
        .object({
          id: z.uuid(),
          attempt: count,
          submittedAt: z.iso.datetime(),
          correct: count,
          wrong: count,
          isCurrent: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();

const byId = z.object({ id: z.uuid() });

export const reviewRouter = router({
  /** The number on «Проверка домашек» in the menu. */
  waiting: teacherProcedure.output(count).query(({ ctx }) => waitingCount(ctx.db, ctx.teacherId)),

  list: teacherProcedure
    .input(z.object({ studentId: z.uuid().nullable() }))
    .output(z.array(row))
    .query(async ({ ctx, input }) => {
      if (input.studentId && !(await findStudent(ctx.db, ctx.teacherId, input.studentId))) throw notFound();
      return (await listReview(ctx.db, ctx.teacherId, input.studentId)).map((r) => ({
        ...r,
        date: r.date?.toISOString() ?? null,
      }));
    }),

  get: teacherProcedure
    .input(byId)
    .output(submission)
    .query(async ({ ctx, input }) => {
      const found = await findSubmission(ctx.db, ctx.teacherId, input.id);
      if (!found) throw notFound();
      return {
        ...found,
        submittedAt: found.submittedAt.toISOString(),
        attempts: found.attempts.map((a) => ({ ...a, submittedAt: a.submittedAt.toISOString() })),
      };
    }),

  /** Called when the teacher opens a submission. */
  opened: teacherProcedure
    .input(byId)
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      await markOpened(ctx.db, ctx.teacherId, input.id);
      return { ok: true as const };
    }),

  /** «Верно» / «Неверно» on a task of the current submission. */
  mark: teacherProcedure
    .input(z.object({ id: z.uuid(), taskIndex: z.number().int().min(0).max(49), mark: z.boolean() }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      if (!(await markTask(ctx.db, ctx.teacherId, input.id, input.taskIndex, input.mark))) throw notFound();
      return { ok: true as const };
    }),

  comment: teacherProcedure
    .input(z.object({ id: z.uuid(), comment: z.string().max(4000) }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      if (!(await saveComment(ctx.db, ctx.teacherId, input.id, input.comment))) throw notFound();
      return { ok: true as const };
    }),

  /** «Открыть заново для ученика». */
  reopen: teacherProcedure
    .input(byId)
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      const result = await reopenHomework(ctx.db, ctx.teacherId, input.id);
      if (result === "not_found") throw notFound();
      if (result === "busy")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "У ученика уже есть опубликованная домашка: снимите её с публикации, чтобы открыть эту заново",
        });
      return { ok: true as const };
    }),
});
