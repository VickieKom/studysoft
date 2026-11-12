import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { HOMEWORK_FORMAT_VERSION, parseHomework, taskSchema, validateHomework } from "../../../domain/homework-format";
import { imageRefs, storeImages } from "../../homework/images";
import { findStudent } from "../../crm/students";
import {
  findHomework,
  HOMEWORK_STATUSES,
  importDraft,
  listHomework,
  publishHomework,
  unpublishHomework,
  updateDraftTasks,
} from "../../homework/homework";
import { router, teacherProcedure } from "../core/trpc";

const notFound = () => new TRPCError({ code: "NOT_FOUND" });

const summary = z.object({
  id: z.uuid(),
  title: z.string(),
  status: z.enum(HOMEWORK_STATUSES),
  dueDate: z.iso.date().nullable(),
  taskCount: z.number().int(),
});

// Up to 50 tasks, each with a picture of at most 2 MB as base64, would not fit;
// a homework with a few pictures does, and an oversized one still gets a
// message naming the task.
const MAX_IMPORT_LENGTH = 25_000_000;

export const homeworkRouter = router({
  /** Validates the pasted JSON and saves it as a draft; the message names the task and the field. */
  import: teacherProcedure
    .input(z.object({ studentId: z.uuid(), json: z.string().max(MAX_IMPORT_LENGTH) }))
    .output(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await findStudent(ctx.db, ctx.teacherId, input.studentId))) throw notFound();
      const parsed = parseHomework(input.json);
      if (!parsed.ok) throw new TRPCError({ code: "BAD_REQUEST", message: parsed.errors.join("\n") });
      // Pictures arrive as data URLs only: a pasted reference to a stored file is refused.
      const stored = await storeImages(ctx.db, ctx.teacherId, parsed.homework, new Set());
      if (!stored.ok) throw new TRPCError({ code: "BAD_REQUEST", message: stored.errors.join("\n") });
      return { id: await importDraft(ctx.db, ctx.teacherId, input.studentId, stored.homework) };
    }),

  list: teacherProcedure
    .input(z.object({ studentId: z.uuid() }))
    .output(z.array(summary))
    .query(async ({ ctx, input }) => {
      if (!(await findStudent(ctx.db, ctx.teacherId, input.studentId))) throw notFound();
      return (await listHomework(ctx.db, ctx.teacherId, input.studentId)).map(({ createdAt: _c, ...rest }) => rest);
    }),

  /** The preview for the teacher: tasks with their keys, so a wrong key is caught before publishing. */
  get: teacherProcedure
    .input(z.object({ id: z.uuid() }))
    .output(summary.extend({ studentId: z.uuid(), tasks: z.array(taskSchema) }))
    .query(async ({ ctx, input }) => {
      const found = await findHomework(ctx.db, ctx.teacherId, input.id);
      if (!found) throw notFound();
      const { createdAt: _c, ...rest } = found;
      return rest;
    }),

  /**
   * Saves the edited tasks of a draft (#37). The whole list is validated
   * against the homework format; the message names the task and the field.
   */
  updateTasks: teacherProcedure
    .input(z.object({ id: z.uuid(), tasks: z.array(z.unknown()).max(50) }))
    .output(z.object({ tasks: z.array(taskSchema) }))
    .mutation(async ({ ctx, input }) => {
      const draft = await findHomework(ctx.db, ctx.teacherId, input.id);
      if (!draft || draft.status !== "draft") throw notFound();
      const checked = validateHomework({ version: HOMEWORK_FORMAT_VERSION, title: draft.title, tasks: input.tasks });
      if (!checked.ok) throw new TRPCError({ code: "BAD_REQUEST", message: checked.errors.join("\n") });
      // New pictures come as data URLs; a stored one may stay only if this draft already has it.
      const keep = imageRefs({ version: HOMEWORK_FORMAT_VERSION, title: draft.title, tasks: draft.tasks });
      const stored = await storeImages(ctx.db, ctx.teacherId, checked.homework, keep);
      if (!stored.ok) throw new TRPCError({ code: "BAD_REQUEST", message: stored.errors.join("\n") });
      if (!(await updateDraftTasks(ctx.db, ctx.teacherId, input.id, stored.homework))) throw notFound();
      return { tasks: stored.homework.tasks };
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
