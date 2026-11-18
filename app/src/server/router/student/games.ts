import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { gameResultSchema } from "../../../domain/game-result-format";
import { saveGameResult } from "../../library/game-results";
import { studentGame, studentGames } from "../../library/student-games";
import { router, studentProcedure } from "../core/trpc";

// The games the teacher opened to the student during a lesson (#118): only
// the title and where the game is served. Tags, other materials and other
// students' games never go out; a game not open to this student is the same
// NOT_FOUND as a missing one. A game posts its result in the game result
// format (#119); the server checks it again and keeps it only while the game
// is open to this student.

const fileUrl = (id: string) => `/api/files/library/${id}`;

const game = z.object({ id: z.uuid(), title: z.string(), fileUrl: z.string().startsWith("/api/files/library/") }).strict();

export const studentGamesRouter = router({
  list: studentProcedure.output(z.array(game)).query(async ({ ctx }) =>
    (await studentGames(ctx.db, ctx.teacherId, ctx.studentId)).map((g) => ({ ...g, fileUrl: fileUrl(g.id) })),
  ),

  get: studentProcedure
    .input(z.object({ id: z.uuid() }))
    .output(game)
    .query(async ({ ctx, input }) => {
      const found = await studentGame(ctx.db, ctx.teacherId, ctx.studentId, input.id.toLowerCase());
      if (!found) throw new TRPCError({ code: "NOT_FOUND" });
      return { ...found, fileUrl: fileUrl(found.id) };
    }),

  saveResult: studentProcedure
    .input(z.object({ id: z.uuid(), result: z.unknown() }))
    .output(z.object({ kept: z.literal(true) }).strict())
    .mutation(async ({ ctx, input }) => {
      const parsed = gameResultSchema.safeParse(input.result);
      if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: "Not a game result" });
      const kept = await saveGameResult(ctx.db, ctx.teacherId, ctx.studentId, input.id.toLowerCase(), parsed.data.answers);
      if (!kept) throw new TRPCError({ code: "NOT_FOUND" });
      return { kept: true as const };
    }),
});
