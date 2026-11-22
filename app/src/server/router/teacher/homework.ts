import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { HOMEWORK_FORMAT_VERSION, parseHomework, taskSchema, validateHomework } from "../../../domain/homework-format";
import { taskFileRefs, storeTaskFiles } from "../../homework/images";
import { findStudent } from "../../crm/students";
import { studentWordIds, wordsToPick } from "../../crm/vocabulary-homework";
import { taskWordIds, withKnownWords } from "../../../domain/vocabulary-homework";
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
// The teacher's page is older than the draft (#99): she reloads and sees the new version.
const changed = () =>
  new TRPCError({
    code: "CONFLICT",
    message: "Черновик изменился, пока страница была открыта. Обновите страницу, чтобы увидеть новую версию",
  });
// The revision the page has seen, as `get` gave it (an md5 in hex).
const revision = z.string().max(64);

const summary = z.object({
  id: z.uuid(),
  title: z.string(),
  status: z.enum(HOMEWORK_STATUSES),
  dueDate: z.iso.date().nullable(),
  taskCount: z.number().int(),
  fromAssistant: z.boolean(),
});

// Up to 50 tasks, each with a picture of at most 2 MB as base64, would not fit;
// a homework with a few pictures does, and an oversized one still gets a
// message naming the task.
// Room for three or four recordings of up to 10 MB with their pictures, as base64 (#127).
const MAX_IMPORT_LENGTH = 40_000_000;

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
      const stored = await storeTaskFiles(ctx.db, ctx.teacherId, parsed.homework, new Set());
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

  /**
   * The preview for the teacher: tasks with their keys, so a wrong key is
   * caught before publishing, and the revision her page sends back (#99).
   */
  get: teacherProcedure
    .input(z.object({ id: z.uuid() }))
    .output(summary.extend({ studentId: z.uuid(), tasks: z.array(taskSchema), revision }))
    .query(async ({ ctx, input }) => {
      const found = await findHomework(ctx.db, ctx.teacherId, input.id);
      if (!found) throw notFound();
      const { createdAt: _c, ...rest } = found;
      return rest;
    }),

  /**
   * Saves the edited tasks of a draft (#37). The whole list is validated
   * against the homework format; the message names the task and the field.
   * A page older than the draft is refused (#99); the check here spares
   * storing its pictures, the one under the lock decides.
   */
  updateTasks: teacherProcedure
    .input(z.object({ id: z.uuid(), revision, tasks: z.array(z.unknown()).max(50) }))
    .output(z.object({ tasks: z.array(taskSchema), revision }))
    .mutation(async ({ ctx, input }) => {
      const draft = await findHomework(ctx.db, ctx.teacherId, input.id);
      if (!draft || draft.status !== "draft") throw notFound();
      if (draft.revision !== input.revision) throw changed();
      const checked = validateHomework({ version: HOMEWORK_FORMAT_VERSION, title: draft.title, tasks: input.tasks });
      if (!checked.ok) throw new TRPCError({ code: "BAD_REQUEST", message: checked.errors.join("\n") });
      // New pictures come as data URLs; a stored one may stay only if this draft already has it.
      const keep = taskFileRefs({ version: HOMEWORK_FORMAT_VERSION, title: draft.title, tasks: draft.tasks });
      // A task keeps only words of this student's vocabulary (#281).
      const known = await studentWordIds(ctx.db, ctx.teacherId, draft.studentId, taskWordIds(checked.homework.tasks));
      const homework = { ...checked.homework, tasks: withKnownWords(checked.homework.tasks, known) };
      const stored = await storeTaskFiles(ctx.db, ctx.teacherId, homework, keep);
      if (!stored.ok) throw new TRPCError({ code: "BAD_REQUEST", message: stored.errors.join("\n") });
      const saved = await updateDraftTasks(ctx.db, ctx.teacherId, input.id, input.revision, stored.homework);
      if (saved === "not_found") throw notFound();
      if (saved === "changed") throw changed();
      return { tasks: stored.homework.tasks, revision: saved.revision };
    }),

  /** «Из словаря» (#281): the draft's student's words with a confirmed translation, the ones to start with ticked. */
  vocabulary: teacherProcedure
    .input(z.object({ id: z.uuid() }))
    .output(z.array(z.object({ id: z.uuid(), word: z.string(), translation: z.string(), example: z.string().nullable(), ticked: z.boolean() }).strict()))
    .query(async ({ ctx, input }) => {
      const draft = await findHomework(ctx.db, ctx.teacherId, input.id);
      if (!draft || draft.status !== "draft") throw notFound();
      return wordsToPick(ctx.db, ctx.teacherId, draft.studentId);
    }),

  /** Publishes the version of the draft the teacher's page has seen, and no other (#99). */
  publish: teacherProcedure
    .input(z.object({ id: z.uuid(), revision, dueDate: z.iso.date() }))
    .output(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const published = await publishHomework(ctx.db, ctx.teacherId, input.id, input.revision, input.dueDate);
      if (published === "not_found") throw notFound();
      if (published === "changed") throw changed();
      if (published === "past")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Срок не может быть раньше сегодняшнего дня" });
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
