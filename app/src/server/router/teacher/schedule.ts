import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { DURATIONS } from "../../../domain/schedule";
import { TIME_ZONE_IDS } from "../../../domain/student";
import { setTeacherTimeZone, teacherTimeZone } from "../../access/settings";
import { findStudent } from "../../crm/students";
import {
  addLesson,
  addSlot,
  lessonHistory,
  listSlots,
  markLesson,
  needsMark,
  weekLessons,
} from "../../schedule/schedule";
import { router, teacherProcedure } from "../core/trpc";

// The schedule (#80). Teacher procedures only; times go out as moments (ISO)
// with both time zones, and the screens show them.

const notFound = () => new TRPCError({ code: "NOT_FOUND" });
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const duration = z.union(DURATIONS.map((d) => z.literal(d)) as [z.ZodLiteral<45>, z.ZodLiteral<60>, z.ZodLiteral<90>]);

const STATUSES = ["scheduled", "held", "missed"] as const;
const status = (value: string) => (STATUSES as readonly string[]).includes(value) ? (value as (typeof STATUSES)[number]) : "scheduled";
const markOutput = {
  status: z.enum(STATUSES),
  charged: z.boolean().nullable(),
  unit: z.string().nullable(),
  note: z.string().nullable(),
  needsMark: z.boolean(),
};
const MAX_MARK_TEXT = 5000;
const markText = z
  .string()
  .max(MAX_MARK_TEXT)
  .transform((value) => (value.trim() === "" ? null : value));

const slotOutput = z
  .object({ id: z.uuid(), weekday: z.number().int(), startTime: z.string(), durationMinutes: z.number().int() })
  .strict();

export const scheduleRouter = router({
  /** The week starting on this Monday, in the teacher's time zone. */
  week: teacherProcedure
    .input(z.object({ monday: z.iso.date() }))
    .output(
      z
        .object({
          timeZone: z.string(),
          lessons: z.array(
            z
              .object({
                id: z.uuid(),
                studentName: z.string(),
                studentTimeZone: z.string(),
                startsAt: z.iso.datetime(),
                durationMinutes: z.number().int(),
                kind: z.enum(["regular", "intro"]),
                ...markOutput,
              })
              .strict(),
          ),
        })
        .strict(),
    )
    .query(async ({ ctx, input }) => {
      const week = await weekLessons(ctx.db, ctx.teacherId, input.monday);
      return {
        timeZone: week.timeZone,
        lessons: week.lessons.map((l) => ({
          ...l,
          startsAt: l.startsAt.toISOString(),
          kind: l.kind === "intro" ? ("intro" as const) : ("regular" as const),
          status: status(l.status),
          needsMark: needsMark(l),
        })),
      };
    }),

  /** «+ Урок»: a one-off lesson at the student's local date and time. */
  addLesson: teacherProcedure
    .input(
      z.object({ studentId: z.uuid(), date: z.iso.date(), time, durationMinutes: duration, intro: z.boolean() }),
    )
    .output(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { studentId, ...lesson } = input;
      const id = await addLesson(ctx.db, ctx.teacherId, studentId, lesson);
      if (!id) throw notFound();
      return { id };
    }),

  /** «Проведён» / «Пропущен» on a lesson that has started; it can be changed at any time (#82). */
  mark: teacherProcedure
    .input(
      z.object({
        lessonId: z.uuid(),
        status: z.enum(["held", "missed"]),
        charged: z.boolean(),
        unit: markText,
        note: markText,
      }),
    )
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      const { lessonId, ...mark } = input;
      if (!(await markLesson(ctx.db, ctx.teacherId, lessonId, mark))) throw notFound();
      return { ok: true as const };
    }),

  /** The lesson history on the card: lessons that have started, newest first (#82). Teacher only. */
  history: teacherProcedure
    .input(z.object({ studentId: z.uuid() }))
    .output(
      z.array(
        z
          .object({
            id: z.uuid(),
            startsAt: z.iso.datetime(),
            durationMinutes: z.number().int(),
            kind: z.enum(["regular", "intro"]),
            ...markOutput,
          })
          .strict(),
      ),
    )
    .query(async ({ ctx, input }) => {
      if (!(await findStudent(ctx.db, ctx.teacherId, input.studentId))) throw notFound();
      return (await lessonHistory(ctx.db, ctx.teacherId, input.studentId)).map((l) => ({
        ...l,
        startsAt: l.startsAt.toISOString(),
        kind: l.kind === "intro" ? ("intro" as const) : ("regular" as const),
        status: status(l.status),
        needsMark: needsMark(l),
      }));
    }),

  slots: teacherProcedure
    .input(z.object({ studentId: z.uuid() }))
    .output(z.array(slotOutput))
    .query(async ({ ctx, input }) => {
      if (!(await findStudent(ctx.db, ctx.teacherId, input.studentId))) throw notFound();
      return listSlots(ctx.db, ctx.teacherId, input.studentId);
    }),

  /** «Добавить слот»: weekday and time in the student's time zone; lessons are created 4 weeks ahead. */
  addSlot: teacherProcedure
    .input(
      z.object({
        studentId: z.uuid(),
        weekday: z.number().int().min(0).max(6),
        startTime: time,
        durationMinutes: duration,
      }),
    )
    .output(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { studentId, ...slot } = input;
      const id = await addSlot(ctx.db, ctx.teacherId, studentId, slot);
      if (!id) throw notFound();
      return { id };
    }),
});

export const settingsRouter = router({
  get: teacherProcedure
    .output(z.object({ timeZone: z.string() }).strict())
    .query(async ({ ctx }) => ({ timeZone: await teacherTimeZone(ctx.db, ctx.teacherId) })),

  /** «Настройки» → «Часовой пояс». */
  save: teacherProcedure
    .input(z.object({ timeZone: z.enum(TIME_ZONE_IDS) }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      await setTeacherTimeZone(ctx.db, ctx.teacherId, input.timeZone);
      return { ok: true as const };
    }),
});
