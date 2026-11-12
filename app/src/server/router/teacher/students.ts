import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ACTIVE_STATUSES, isBlank, LEVELS, PROFILE_KEYS, type ProfileKey, STATUSES, TIME_ZONE_IDS } from "../../../domain/student";
import { ensureLink, revokeLinks, withStudentLocked } from "../../access/links";
import { createStudent, findStudent, listStudents, updateStudent } from "../../crm/students";
import { router, teacherProcedure } from "../core/trpc";

// No format checks on names (#18): whatever the teacher types is stored as
// typed. Only an empty first name is refused. The length cap only keeps a
// request from carrying megabytes.
const MAX_NAME_LENGTH = 1000;

const firstName = z
  .string()
  .max(MAX_NAME_LENGTH)
  .refine((value) => !isBlank(value), { message: "first name is required" });
const lastName = z
  .string()
  .max(MAX_NAME_LENGTH)
  .transform((value) => (isBlank(value) ? null : value));

// Profile fields (#41): optional plain text, stored as typed; blank is none.
const MAX_PROFILE_LENGTH = 5000;
const profileValue = z
  .string()
  .max(MAX_PROFILE_LENGTH)
  .transform((value) => (isBlank(value) ? null : value));
const profileInput = z.object(
  Object.fromEntries(PROFILE_KEYS.map((key) => [key, profileValue.optional()])) as Record<
    ProfileKey,
    z.ZodOptional<typeof profileValue>
  >,
);
const profileOutput = z.object(
  Object.fromEntries(PROFILE_KEYS.map((key) => [key, z.string().nullable()])) as Record<ProfileKey, z.ZodNullable<z.ZodString>>,
);

const fields = z.object({
  firstName,
  lastName,
  level: z.enum(LEVELS),
  timeZone: z.enum(TIME_ZONE_IDS),
});

const studentCard = profileOutput.extend({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string().nullable(),
  level: z.enum(LEVELS),
  timeZone: z.enum(TIME_ZONE_IDS),
  status: z.enum(STATUSES),
});

const notFound = () => new TRPCError({ code: "NOT_FOUND" });

export const studentsRouter = router({
  /** Without a status: every student except "Завершили", which is the archive. */
  list: teacherProcedure
    .input(z.object({ status: z.enum(STATUSES).optional() }).optional())
    .output(z.array(studentCard))
    .query(({ ctx, input }) => listStudents(ctx.db, ctx.teacherId, input?.status ? [input.status] : ACTIVE_STATUSES)),

  get: teacherProcedure
    .input(z.object({ id: z.uuid() }))
    .output(studentCard)
    .query(async ({ ctx, input }) => {
      const card = await findStudent(ctx.db, ctx.teacherId, input.id);
      if (!card) throw notFound();
      return card;
    }),

  create: teacherProcedure
    .input(fields)
    .output(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const id = await createStudent(ctx.db, ctx.teacherId, input);
      // Both links exist from the start (#19, #20); copying one later never changes it.
      await ensureLink(ctx.db, ctx.teacherId, id, "student");
      await ensureLink(ctx.db, ctx.teacherId, id, "parent");
      return { id };
    }),

  update: teacherProcedure
    .input(fields.extend({ id: z.uuid(), status: z.enum(STATUSES) }).merge(profileInput))
    .output(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...changes } = input;
      // "Завершили" closes both links (#21), in one transaction with the
      // status that holds the student row: a copy or a reissue waits for it
      // and then sees the student finished (#65). Coming back reissues the
      // links on the first copy.
      const saved = await withStudentLocked(ctx.db, ctx.teacherId, id, async (tx) => {
        if (changes.status === "finished") await revokeLinks(tx, ctx.teacherId, id);
        return updateStudent(tx, ctx.teacherId, id, changes);
      });
      if (!saved) throw notFound();
      return { id };
    }),
});
