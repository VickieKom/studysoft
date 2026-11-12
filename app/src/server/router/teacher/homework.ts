import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { parseHomework } from "../../../domain/homework-format";
import { findStudent } from "../../crm/students";
import {
  findHomework,
  HOMEWORK_STATUSES,
  importDraft,
  listHomework,
  publishHomework,
  unpublishHomework,
} from "../../homework/homework";
import { router, teacherProcedure } from "../core/trpc";

const notFound = () => new TRPCError({ code: "NOT_FOUND" });

// The preview is the student's view: never a key, even for the teacher (#32).
const studentTask = z.discriminatedUnion("type", [
  z.object({ type: z.enum(["single_choice", "multiple_choice"]), prompt: z.string(), options: z.array(z.string()) }).strict(),
  z.object({ type: z.literal("gap"), prompt: z.string(), text: z.string(), options: z.array(z.string()).optional() }).strict(),
  z.object({ type: z.literal("match"), prompt: z.string(), left: z.array(z.string()), right: z.array(z.string()) }).strict(),
  z.object({ type: z.literal("order"), prompt: z.string(), words: z.array(z.string()) }).strict(),
  z.object({ type: z.enum(["written", "voice"]), prompt: z.string(), hint: z.string().optional() }).strict(),
  z
    .object({
      type: z.literal("file"),
      prompt: z.string(),
      accept: z.array(z.enum(["image", "audio"])),
      hint: z.string().optional(),
    })
    .strict(),
]);

const summary = z.object({
  id: z.uuid(),
  title: z.string(),
  status: z.enum(HOMEWORK_STATUSES),
  dueDate: z.iso.date().nullable(),
  taskCount: z.number().int(),
});

const MAX_IMPORT_LENGTH = 1_000_000;

export const homeworkRouter = router({
  /** Validates the pasted JSON and saves it as a draft; the message names the task and the field. */
  import: teacherProcedure
    .input(z.object({ studentId: z.uuid(), json: z.string().max(MAX_IMPORT_LENGTH) }))
    .output(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await findStudent(ctx.db, ctx.teacherId, input.studentId))) throw notFound();
      const parsed = parseHomework(input.json);
      if (!parsed.ok) throw new TRPCError({ code: "BAD_REQUEST", message: parsed.errors.join("\n") });
      return { id: await importDraft(ctx.db, ctx.teacherId, input.studentId, parsed.homework) };
    }),

  list: teacherProcedure
    .input(z.object({ studentId: z.uuid() }))
    .output(z.array(summary))
    .query(async ({ ctx, input }) => {
      if (!(await findStudent(ctx.db, ctx.teacherId, input.studentId))) throw notFound();
      return (await listHomework(ctx.db, ctx.teacherId, input.studentId)).map(({ createdAt: _c, ...rest }) => rest);
    }),

  get: teacherProcedure
    .input(z.object({ id: z.uuid() }))
    .output(summary.extend({ studentId: z.uuid(), tasks: z.array(studentTask) }))
    .query(async ({ ctx, input }) => {
      const found = await findHomework(ctx.db, ctx.teacherId, input.id);
      if (!found) throw notFound();
      const { createdAt: _c, ...rest } = found;
      return rest;
    }),

  publish: teacherProcedure
    .input(z.object({ id: z.uuid(), dueDate: z.iso.date() }))
    .output(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await publishHomework(ctx.db, ctx.teacherId, input.id, input.dueDate))) throw notFound();
      return { id: input.id };
    }),

  unpublish: teacherProcedure
    .input(z.object({ id: z.uuid() }))
    .output(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await unpublishHomework(ctx.db, ctx.teacherId, input.id))) throw notFound();
      return { id: input.id };
    }),
});
