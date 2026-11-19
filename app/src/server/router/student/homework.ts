import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { answerSchema, studentAnswerSchema } from "../../../domain/homework-format";
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

const text = z.string();
// A picture goes out as the address it is served at, never as the stored reference.
const image = z.string().startsWith("/api/files/homework/").optional();
// The reading text and the example of a workbook exercise (#131): part of the exercise, not keys.
const parts = {
  passage: text.optional(),
  example: z.object({ text, answer: text.optional() }).strict().optional(),
};
// A recording to listen to (#127), by its address as a picture is.
const audio = z.string().startsWith("/api/files/homework/").optional();
const picture = z.string().startsWith("/api/files/homework/");
const otherTask = z.discriminatedUnion("type", [
  z
    .object({
      type: z.enum(["single_choice", "multiple_choice"]),
      prompt: text,
      // An option is text, or pictures by their addresses with an optional caption (#129).
      options: z.array(z.union([text, z.object({ images: z.array(picture).min(1), text: text.optional() }).strict()])),
      image,
      audio,
      ...parts,
    })
    .strict(),
  z
    .object({
      type: z.literal("gap"),
      prompt: text,
      text,
      options: z.array(text).optional(),
      // A gap's own options (#128): what the student picks from, never which is right.
      choices: z.array(z.array(text).nullable()).optional(),
      // A picture by each gap, by its address (#181).
      gapImages: z.array(picture.nullable()).optional(),
      image,
      audio,
      ...parts,
    })
    .strict(),
  z.object({ type: z.literal("match"), prompt: text, left: z.array(text), right: z.array(text), image, audio, ...parts }).strict(),
  z.object({ type: z.enum(["written", "voice"]), prompt: text, hint: text.optional(), image, audio, ...parts }).strict(),
  z
    .object({
      type: z.literal("file"),
      prompt: text,
      accept: z.array(z.enum(["image", "audio"])),
      hint: text.optional(),
      image,
      audio,
      ...parts,
    })
    .strict(),
]);
// An order task: one sentence in `words`, or several in `sentences`, each shuffled (#161).
const studentTask = z.union([
  otherTask,
  z.object({ type: z.literal("order"), prompt: text, words: z.array(text), image, audio, ...parts }).strict(),
  z.object({ type: z.literal("order"), prompt: text, sentences: z.array(z.array(text)), image, audio, ...parts }).strict(),
]);

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
});
