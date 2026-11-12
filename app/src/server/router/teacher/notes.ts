import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { isBlank } from "../../../domain/student";
import { addNote, deleteNote, listNotes, type Note, updateNote } from "../../crm/notes";
import { findStudent } from "../../crm/students";
import { router, teacherProcedure } from "../core/trpc";

// A note is free text; only an empty one is refused. The cap keeps requests small.
const MAX_NOTE_LENGTH = 20_000;
const body = z
  .string()
  .max(MAX_NOTE_LENGTH)
  .refine((value) => !isBlank(value), { message: "note is empty" });

// Dates travel as ISO strings: the router has no transformer, so a Date would
// reach the browser as a string anyway.
const noteOutput = z.object({ id: z.uuid(), body: z.string(), createdAt: z.iso.datetime() });
const toOutput = (note: Note) => ({ id: note.id, body: note.body, createdAt: note.createdAt.toISOString() });

const notFound = () => new TRPCError({ code: "NOT_FOUND" });

export const notesRouter = router({
  /** Notes on a student, newest first. Another teacher's student answers like a missing one. */
  list: teacherProcedure
    .input(z.object({ studentId: z.uuid() }))
    .output(z.array(noteOutput))
    .query(async ({ ctx, input }) => {
      if (!(await findStudent(ctx.db, ctx.teacherId, input.studentId))) throw notFound();
      return (await listNotes(ctx.db, ctx.teacherId, input.studentId)).map(toOutput);
    }),

  add: teacherProcedure
    .input(z.object({ studentId: z.uuid(), body }))
    .output(noteOutput)
    .mutation(async ({ ctx, input }) => {
      if (!(await findStudent(ctx.db, ctx.teacherId, input.studentId))) throw notFound();
      return toOutput(await addNote(ctx.db, ctx.teacherId, input.studentId, input.body));
    }),

  update: teacherProcedure
    .input(z.object({ id: z.uuid(), body }))
    .output(noteOutput)
    .mutation(async ({ ctx, input }) => {
      const updated = await updateNote(ctx.db, ctx.teacherId, input.id, input.body);
      if (!updated) throw notFound();
      return toOutput(updated);
    }),

  delete: teacherProcedure
    .input(z.object({ id: z.uuid() }))
    .output(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await deleteNote(ctx.db, ctx.teacherId, input.id))) throw notFound();
      return { id: input.id };
    }),
});
