import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { todayIn } from "../../../domain/homework";
import {
  DECLINE_REASONS,
  MAX_DECLINE_COMMENT_LENGTH,
  MAX_REQUEST_CONTACT_LENGTH,
  MAX_REQUEST_NAME_LENGTH,
  MAX_REQUEST_SCHOOL_YEAR_LENGTH,
  OPEN_STAGES,
  REQUEST_SOURCES,
  REQUEST_STAGES,
} from "../../../domain/requests";
import { teacherTimeZone } from "../../access/settings";
import { createRequest, deleteRequest, listRequests, moveRequest } from "../../crm/requests";
import { router, teacherProcedure } from "../core/trpc";

// «Привлечение клиентов» (#337): the teacher's requests by stage. Teacher
// only; a request of another teacher is the same NOT_FOUND as a missing one.

const notFound = () => new TRPCError({ code: "NOT_FOUND" });
/** Trimmed; empty for none. */
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) => value.trim() || null);

const request = z
  .object({
    id: z.uuid(),
    firstName: z.string(),
    age: z.number().int().nullable(),
    schoolYear: z.string().nullable(),
    contact: z.string().nullable(),
    source: z.enum(REQUEST_SOURCES),
    requestedOn: z.iso.date(),
    stage: z.enum(REQUEST_STAGES),
    declineReason: z.enum(DECLINE_REASONS).nullable(),
    declineComment: z.string().nullable(),
  })
  .strict();

export const requestsRouter = router({
  /** The requests that are not deleted, and today in the teacher's time zone for «Новая заявка». */
  list: teacherProcedure
    .output(z.object({ requests: z.array(request), today: z.iso.date() }).strict())
    .query(async ({ ctx }) => ({
      requests: await listRequests(ctx.db, ctx.teacherId),
      today: todayIn(await teacherTimeZone(ctx.db, ctx.teacherId)),
    })),

  /** «Новая заявка»: the child's first name and the source are required. */
  create: teacherProcedure
    .input(
      z.object({
        firstName: z.string().trim().min(1, "Укажите имя ребёнка").max(MAX_REQUEST_NAME_LENGTH),
        age: z.number().int().min(1).max(99).nullable(),
        schoolYear: optionalText(MAX_REQUEST_SCHOOL_YEAR_LENGTH),
        contact: optionalText(MAX_REQUEST_CONTACT_LENGTH),
        source: z.enum(REQUEST_SOURCES),
        requestedOn: z.iso.date(),
      }),
    )
    .output(z.object({ id: z.uuid() }).strict())
    .mutation(({ ctx, input }) => createRequest(ctx.db, ctx.teacherId, input)),

  /** To any stage; «Отказ» with a reason and an optional comment, which any other stage clears. */
  move: teacherProcedure
    .input(
      z.discriminatedUnion("stage", [
        z.object({ id: z.uuid(), stage: z.enum(OPEN_STAGES) }),
        z.object({ id: z.uuid(), stage: z.literal("declined"), reason: z.enum(DECLINE_REASONS), comment: optionalText(MAX_DECLINE_COMMENT_LENGTH) }),
      ]),
    )
    .output(z.object({ ok: z.literal(true) }).strict())
    .mutation(async ({ ctx, input }) => {
      const { id, ...move } = input;
      if (!(await moveRequest(ctx.db, ctx.teacherId, id.toLowerCase(), move))) throw notFound();
      return { ok: true as const };
    }),

  /** «Удалить заявку»: everything personal is erased; an anonymous count stays for the metrics. */
  remove: teacherProcedure
    .input(z.object({ id: z.uuid() }))
    .output(z.object({ ok: z.literal(true) }).strict())
    .mutation(async ({ ctx, input }) => {
      if (!(await deleteRequest(ctx.db, ctx.teacherId, input.id.toLowerCase()))) throw notFound();
      return { ok: true as const };
    }),
});
