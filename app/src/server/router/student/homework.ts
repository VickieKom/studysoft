import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ALL_KINDS_ANSWER } from "../../../domain/homework";
import { answerSchema, studentAnswerSchema, TASK_TYPES } from "../../../domain/homework-format";
import { studentTaskSchema } from "../../../domain/student-task-schema";
import { answerMiniQuestion, miniQuestion } from "../../homework/feedback";
import { currentHomeworkForStudent, openHomework, saveAnswer, submitHomework } from "../../homework/homework";
import { router, studentProcedure } from "../core/trpc";

// The student's side of a homework (#34). Every output is strict and has no
// key: the tasks go out as studentView(), checking happens on the server, and
// the score after submission says how many, never which (AGENTS.md, rule 4).
// A recording or a file is uploaded to its own address, not through here (#35).

const result = z
  .object({ correct: z.number().int(), wrong: z.number().int(), pending: z.number().int() })
  .strict();

const current = z
  .object({ id: z.uuid(), dueDate: z.iso.date(), taskCount: z.number().int(), result: result.nullable() })
  .strict()
  .nullable();

const studentTask = studentTaskSchema("/api/files/homework/");

const notFound = () => new TRPCError({ code: "NOT_FOUND" });

export const studentHomeworkRouter = router({
  /** The current homework: the deadline, the number of tasks and, once submitted, the score. */
  current: studentProcedure
    .output(current)
    .query(({ ctx }) => currentHomeworkForStudent(ctx.db, ctx.teacherId, ctx.studentId)),

  /** The tasks to do and the answers saved so far. Only while the homework is published. */
  open: studentProcedure
    .input(z.object({ id: z.uuid() }))
    .output(z.object({ tasks: z.array(studentTask), answers: z.array(studentAnswerSchema.nullable()) }).strict())
    .query(async ({ ctx, input }) => {
      const opened = await openHomework(ctx.db, ctx.teacherId, ctx.studentId, input.id);
      if (!opened) throw notFound();
      return opened;
    }),

  /** Saves the answer to one task; null clears it, a recording or a file included. */
  saveAnswer: studentProcedure
    .input(z.object({ id: z.uuid(), taskIndex: z.number().int().min(0).max(49), answer: answerSchema.nullable() }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      const saved = await saveAnswer(ctx.db, ctx.teacherId, ctx.studentId, input.id, input.taskIndex, input.answer);
      if (saved === "not_found") throw notFound();
      if (saved === "invalid") throw new TRPCError({ code: "BAD_REQUEST" });
      return { ok: true as const };
    }),

  /** «Сдать», once. The same idempotency key gets the same score back; a second submission is refused. */
  submit: studentProcedure
    .input(z.object({ id: z.uuid(), idempotencyKey: z.uuid() }))
    .output(result)
    .mutation(async ({ ctx, input }) => {
      const submitted = await submitHomework(ctx.db, ctx.teacherId, ctx.studentId, input.id, input.idempotencyKey);
      if (submitted === "not_found") throw notFound();
      if (submitted === "conflict") throw new TRPCError({ code: "CONFLICT" });
      return submitted;
    }),

  /**
   * «Какое задание было самым интересным?» after the first «Сдать» (#331):
   * the kinds of the homework's tasks to choose from, or null when there is
   * nothing to ask. The output carries the kinds only, never an answer.
   */
  miniQuestion: studentProcedure
    .input(z.object({ id: z.uuid() }))
    .output(z.object({ kinds: z.array(z.enum(TASK_TYPES)) }).strict().nullable())
    .query(({ ctx, input }) => miniQuestion(ctx.db, ctx.teacherId, ctx.studentId, input.id.toLowerCase())),

  /** The child's pick: a kind the question offered, «Все классные», or null for «Пропустить»; once. */
  answerMiniQuestion: studentProcedure
    .input(z.object({ id: z.uuid(), answer: z.enum([...TASK_TYPES, ALL_KINDS_ANSWER]).nullable() }))
    .output(z.object({ ok: z.literal(true) }).strict())
    .mutation(async ({ ctx, input }) => {
      if (!(await answerMiniQuestion(ctx.db, ctx.teacherId, ctx.studentId, input.id.toLowerCase(), input.answer))) throw notFound();
      return { ok: true as const };
    }),
});
