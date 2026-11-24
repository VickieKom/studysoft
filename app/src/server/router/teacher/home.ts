import { z } from "zod";
import { PROGRESS_SKILLS } from "../../../domain/progress";
import { STATUSES } from "../../../domain/student";
import { teacherOverview } from "../../crm/overview";
import { ratingAcrossStudents, studentsWithNewFeedback } from "../../homework/feedback-rating";
import { router, teacherProcedure } from "../core/trpc";
import { feedbackRatingSchema } from "./feedback-rating-schema";

// «Главная» (#257): the lessons ahead, the students with their numbers and
// what needs the teacher. The teacher's only; nothing here reaches a
// student, a parent or the assistant.

const homeworkState = z.enum(["published", "submitted", "missed"]).nullable();
const skillTrend = z.object({ skill: z.enum(PROGRESS_SKILLS), trend: z.number().int() }).strict();

export const homeRouter = router({
  get: teacherProcedure
    .output(
      z
        .object({
          timeZone: z.string(),
          lessons: z.array(
            z
              .object({
                id: z.uuid(),
                studentId: z.uuid(),
                firstName: z.string(),
                startsAt: z.iso.datetime(),
                durationMinutes: z.number().int(),
                studentTimeZone: z.string(),
                book: z.string().nullable(),
                homework: homeworkState,
                prepared: z.boolean(),
              })
              .strict(),
          ),
          students: z.array(
            z
              .object({
                id: z.uuid(),
                firstName: z.string(),
                lastName: z.string().nullable(),
                status: z.enum(STATUSES),
                textbook: z.object({ title: z.string(), unitsPassed: z.number().int(), units: z.number().int() }).strict().nullable(),
                homework: z.object({ submitted: z.number().int(), due: z.number().int() }).strict(),
                trends: z.array(skillTrend),
                slips: z.array(skillTrend),
                homeworkNotSubmitted: z.boolean(),
                runningOut: z.string().nullable(),
              })
              .strict(),
          ),
        })
        .strict(),
    )
    .query(async ({ ctx }) => {
      const overview = await teacherOverview(ctx.db, ctx.teacherId);
      return { ...overview, lessons: overview.lessons.map((l) => ({ ...l, startsAt: l.startsAt.toISOString() })) };
    }),

  /**
   * «Новый фидбэк» (#333): the students with an answer newer than the newest
   * one their «Фидбэк» showed the teacher, and what her children like across
   * students.
   */
  feedback: teacherProcedure
    .output(
      z
        .object({
          newFeedback: z.array(z.object({ id: z.uuid(), firstName: z.string() }).strict()),
          across: feedbackRatingSchema,
        })
        .strict(),
    )
    .query(async ({ ctx }) => ({
      newFeedback: await studentsWithNewFeedback(ctx.db, ctx.teacherId),
      across: await ratingAcrossStudents(ctx.db, ctx.teacherId),
    })),
});
