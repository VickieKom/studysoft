import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { answerSchema } from "../../../domain/homework-format";
import { studentTaskSchema } from "../../../domain/student-task-schema";
import { type StudentVideo, studentVideo, studentVideos } from "../../library/student-games";
import { MAX_VIDEO_TASKS } from "../../library/video-tasks";
import { studentVideoTasks, submitVideoAnswers } from "../../library/video-answers";
import { router, studentProcedure } from "../core/trpc";

// The videos the teacher opened to the student during a lesson (#158): the
// title, and where an own file is served or the link it opens. Tags, other
// materials and other students' videos never go out; a video not open to
// this student is the same NOT_FOUND as a missing one. Under a video, its
// confirmed tasks (#327) as the child sees them, without keys, and once
// answered nothing but that they were: no score, no verdict.

const video = z
  .object({
    id: z.uuid(),
    title: z.string(),
    // A library video's own file (#158), or a textbook's (#329).
    fileUrl: z.string().regex(/^\/api\/files\/(library|textbooks)\//).nullable(),
    link: z.url({ protocol: /^https?$/ }).nullable(),
    // Confirmed tasks to answer under it (#327): its page holds them, so a link with tasks opens there.
    hasTasks: z.boolean(),
  })
  .strict();

const shown = (v: StudentVideo, hasTasks: boolean) => ({
  id: v.id,
  title: v.title,
  fileUrl: v.textbook ? `/api/files/textbooks/${v.id}` : v.hasFile ? `/api/files/library/${v.id}` : null,
  link: v.hasFile ? null : v.link,
  hasTasks,
});

const notFound = () => new TRPCError({ code: "NOT_FOUND" });

export const studentVideosRouter = router({
  list: studentProcedure.output(z.array(video)).query(async ({ ctx }) => {
    const videos = await studentVideos(ctx.db, ctx.teacherId, ctx.studentId);
    return Promise.all(videos.map(async (v) => shown(v, (await studentVideoTasks(ctx.db, ctx.teacherId, ctx.studentId, v.id)) !== null)));
  }),

  get: studentProcedure
    .input(z.object({ id: z.uuid() }))
    .output(video)
    .query(async ({ ctx, input }) => {
      const id = input.id.toLowerCase();
      const found = await studentVideo(ctx.db, ctx.teacherId, ctx.studentId, id);
      if (!found) throw notFound();
      return shown(found, (await studentVideoTasks(ctx.db, ctx.teacherId, ctx.studentId, id)) !== null);
    }),

  /** The video's confirmed tasks without keys, and whether they are answered in this lesson; null for a video without tasks. */
  tasks: studentProcedure
    .input(z.object({ id: z.uuid() }))
    .output(z.object({ tasks: z.array(studentTaskSchema("/api/files/video-tasks/")), revision: z.string(), done: z.boolean() }).strict().nullable())
    .query(async ({ ctx, input }) => {
      const id = input.id.toLowerCase();
      if (!(await studentVideo(ctx.db, ctx.teacherId, ctx.studentId, id))) throw notFound();
      return studentVideoTasks(ctx.db, ctx.teacherId, ctx.studentId, id);
    }),

  /**
   * «Готово»: one answer per task, in order, once per lesson, to the tasks the
   * page showed (`revision`). Already answered is CONFLICT; tasks the teacher
   * confirmed anew meanwhile are PRECONDITION_FAILED. The output says nothing
   * of right or wrong.
   */
  submitTasks: studentProcedure
    .input(z.object({ id: z.uuid(), revision: z.string().max(64), answers: z.array(answerSchema.nullable()).max(MAX_VIDEO_TASKS) }))
    .output(z.object({ ok: z.literal(true) }).strict())
    .mutation(async ({ ctx, input }) => {
      const result = await submitVideoAnswers(ctx.db, ctx.teacherId, ctx.studentId, input.id.toLowerCase(), input.revision, input.answers);
      if (result === "not_found") throw notFound();
      if (result === "invalid") throw new TRPCError({ code: "BAD_REQUEST" });
      if (result === "done") throw new TRPCError({ code: "CONFLICT" });
      if (result === "changed") throw new TRPCError({ code: "PRECONDITION_FAILED" });
      return { ok: true as const };
    }),
});
