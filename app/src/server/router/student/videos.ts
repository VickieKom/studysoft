import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { type StudentVideo, studentVideo, studentVideos } from "../../library/student-games";
import { router, studentProcedure } from "../core/trpc";

// The videos the teacher opened to the student during a lesson (#158): the
// title, and where an own file is served or the link it opens. Tags, other
// materials and other students' videos never go out; a video not open to
// this student is the same NOT_FOUND as a missing one.

const video = z
  .object({
    id: z.uuid(),
    title: z.string(),
    fileUrl: z.string().startsWith("/api/files/library/").nullable(),
    link: z.url({ protocol: /^https?$/ }).nullable(),
  })
  .strict();

const shown = (v: StudentVideo) => ({ id: v.id, title: v.title, fileUrl: v.hasFile ? `/api/files/library/${v.id}` : null, link: v.hasFile ? null : v.link });

export const studentVideosRouter = router({
  list: studentProcedure.output(z.array(video)).query(async ({ ctx }) => (await studentVideos(ctx.db, ctx.teacherId, ctx.studentId)).map(shown)),

  get: studentProcedure
    .input(z.object({ id: z.uuid() }))
    .output(video)
    .query(async ({ ctx, input }) => {
      const found = await studentVideo(ctx.db, ctx.teacherId, ctx.studentId, input.id.toLowerCase());
      if (!found) throw new TRPCError({ code: "NOT_FOUND" });
      return shown(found);
    }),
});
