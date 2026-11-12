import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  ACTIVE_STATUSES,
  CONTACT_KEYS,
  type ContactKey,
  isBlank,
  LEVELS,
  PROFILE_KEYS,
  type ProfileKey,
  STATUSES,
  TIME_ZONE_IDS,
} from "../../../domain/student";
import { ensureLink, revokeLinks, withStudentLocked } from "../../access/links";
import { createStudent, findContacts, findStudent, listStudents, saveContacts, updateStudent } from "../../crm/students";
import { removeFutureLessons, topUpLessons } from "../../schedule/schedule";
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

// Contacts (#84): optional plain text like the profile, no format checks.
const contactInput = z.object(
  Object.fromEntries(CONTACT_KEYS.map((key) => [key, profileValue.optional()])) as Record<
    ContactKey,
    z.ZodOptional<typeof profileValue>
  >,
);
const contactOutput = z
  .object(
    Object.fromEntries(CONTACT_KEYS.map((key) => [key, z.string().nullable()])) as Record<
      ContactKey,
      z.ZodNullable<z.ZodString>
    >,
  )
  .strict();

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

  /** The card with the contacts; the list leaves them out. */
  get: teacherProcedure
    .input(z.object({ id: z.uuid() }))
    .output(studentCard.extend({ contacts: contactOutput }))
    .query(async ({ ctx, input }) => {
      const card = await findStudent(ctx.db, ctx.teacherId, input.id);
      if (!card) throw notFound();
      return { ...card, contacts: await findContacts(ctx.db, ctx.teacherId, input.id) };
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
    .input(fields.extend({ id: z.uuid(), status: z.enum(STATUSES) }).merge(profileInput).merge(contactInput))
    .output(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { id, parentName, parentEmail, parentMessenger, studentEmail, studentMessenger, ...changes } = input;
      const contacts = Object.fromEntries(
        Object.entries({ parentName, parentEmail, parentMessenger, studentEmail, studentMessenger }).filter(
          ([, value]) => value !== undefined,
        ),
      );
      // "Завершили" closes both links (#21), in one transaction with the
      // status that holds the student row: a copy or a reissue waits for it
      // and then sees the student finished (#65). Coming back reissues the
      // links on the first copy.
      const saved = await withStudentLocked(ctx.db, ctx.teacherId, id, async (tx) => {
        if (changes.status === "finished") await revokeLinks(tx, ctx.teacherId, id);
        const updated = await updateStudent(tx, ctx.teacherId, id, changes);
        // The profile and the contacts are saved together or not at all.
        if (updated) await saveContacts(tx, ctx.teacherId, id, contacts);
        return updated;
      });
      if (!saved) throw notFound();
      // «На паузе» and «Завершили» take the future lessons off the schedule;
      // back in «Занимается» they come again from the slots (#80).
      if (changes.status === "paused" || changes.status === "finished") await removeFutureLessons(ctx.db, ctx.teacherId, id);
      else await topUpLessons(ctx.db, ctx.teacherId, new Date(), id);
      return { id };
    }),
});
