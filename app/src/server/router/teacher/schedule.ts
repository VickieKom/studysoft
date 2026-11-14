import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { DURATIONS } from "../../../domain/schedule";
import { TIME_ZONE_IDS } from "../../../domain/student";
import { setTeacherTimeZone, teacherTimeZone } from "../../access/settings";
import { findStudent } from "../../crm/students";
import {
  addLesson,
  addSlot,
  cancelLesson,
  changeSlot,
  lessonHistory,
  listSlots,
  markLesson,
  moveLesson,
  needsMark,
  overlaps,
  restoreLesson,
  setMeetingLink,
  weekLessons,
} from "../../schedule/schedule";
import { router, teacherProcedure } from "../core/trpc";

// The schedule (#80). Teacher procedures only; times go out as moments (ISO)
// with both time zones, and the screens show them.

const notFound = () => new TRPCError({ code: "NOT_FOUND" });
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const duration = z.union(DURATIONS.map((d) => z.literal(d)) as [z.ZodLiteral<45>, z.ZodLiteral<60>, z.ZodLiteral<90>]);

const STATUSES = ["scheduled", "held", "missed", "cancelled"] as const;
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
  .object({
    id: z.uuid(),
    weekday: z.number().int(),
    startTime: z.string(),
    durationMinutes: z.number().int(),
    validFrom: z.iso.date(),
    validUntil: z.iso.date().nullable(),
  })
  .strict();

// A meeting link is an address the teacher pasted (#81): http or https only,
// so the screen never offers a script address to open or copy.
const MAX_LINK_LENGTH = 2000;
const meetingLink = z
  .string()
  .trim()
  .max(MAX_LINK_LENGTH)
  .refine((value) => value === "" || /^https?:\/\/\S+$/i.test(value), { message: "not a web address" })
  .transform((value) => (value === "" ? null : value));
const ok = z.object({ ok: z.literal(true) });

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
                studentId: z.uuid(),
                studentName: z.string(),
                studentTimeZone: z.string(),
                startsAt: z.iso.datetime(),
                durationMinutes: z.number().int(),
                kind: z.enum(["regular", "intro"]),
                ...markOutput,
                movedFrom: z.iso.datetime().nullable(),
                meetingLink: z.string().nullable(),
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
          movedFrom: l.movedFrom?.toISOString() ?? null,
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

  /** «Перенести»: another date and time in the student's time zone; the rest of the slot stays (#81). */
  move: teacherProcedure
    .input(z.object({ lessonId: z.uuid(), date: z.iso.date(), time }))
    .output(ok)
    .mutation(async ({ ctx, input }) => {
      const { lessonId, ...to } = input;
      if (!(await moveLesson(ctx.db, ctx.teacherId, lessonId, to))) throw notFound();
      return { ok: true as const };
    }),

  /** «Отменить урок», charged or not; saving a cancelled lesson again changes the choice (#81). */
  cancel: teacherProcedure
    .input(z.object({ lessonId: z.uuid(), charged: z.boolean() }))
    .output(ok)
    .mutation(async ({ ctx, input }) => {
      if (!(await cancelLesson(ctx.db, ctx.teacherId, input.lessonId, input.charged))) throw notFound();
      return { ok: true as const };
    }),

  /** «Вернуть в расписание»: a cancelled lesson is scheduled again (#81). */
  restore: teacherProcedure
    .input(z.object({ lessonId: z.uuid() }))
    .output(ok)
    .mutation(async ({ ctx, input }) => {
      if (!(await restoreLesson(ctx.db, ctx.teacherId, input.lessonId))) throw notFound();
      return { ok: true as const };
    }),

  /** «Сохранить ссылку»: the lesson's own meeting link; blank clears it (#81). */
  setMeetingLink: teacherProcedure
    .input(z.object({ lessonId: z.uuid(), link: meetingLink }))
    .output(ok)
    .mutation(async ({ ctx, input }) => {
      if (!(await setMeetingLink(ctx.db, ctx.teacherId, input.lessonId, input.link))) throw notFound();
      return { ok: true as const };
    }),

  /**
   * Who already has a lesson at this time: the student's local date and time
   * and a duration. The screens warn with it and still let the teacher save (#81).
   */
  overlaps: teacherProcedure
    .input(
      z.object({
        studentId: z.uuid(),
        date: z.iso.date(),
        time,
        durationMinutes: duration,
        exceptLessonId: z.uuid().optional(),
      }),
    )
    .output(z.object({ names: z.array(z.string()) }).strict())
    .query(async ({ ctx, input }) => {
      const { studentId, ...at } = input;
      const names = await overlaps(ctx.db, ctx.teacherId, studentId, at);
      if (!names) throw notFound();
      return { names };
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
            movedFrom: z.iso.datetime().nullable(),
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
        movedFrom: l.movedFrom?.toISOString() ?? null,
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

  /** «Изменить слот» from a date: later lessons follow it; earlier ones and the ones changed by hand stay (#81). */
  changeSlot: teacherProcedure
    .input(
      z.object({
        slotId: z.uuid(),
        weekday: z.number().int().min(0).max(6),
        startTime: time,
        durationMinutes: duration,
        from: z.iso.date(),
      }),
    )
    .output(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { slotId, ...change } = input;
      const id = await changeSlot(ctx.db, ctx.teacherId, slotId, change);
      if (id === "past") throw new TRPCError({ code: "BAD_REQUEST", message: "the date is before the student's today" });
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
