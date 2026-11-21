import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { EXERCISE_TYPES } from "../../../domain/word-training";
import { wordsForStudent } from "../../crm/vocabulary";
import { answerExercise, dueToday, trainingSession } from "../../crm/word-training";
import { router, studentProcedure } from "../core/trpc";

// «Тренировка слов» behind the student's link (#236): their own words only,
// with the translation and example the teacher keeps; nothing else of the card.
// The daily training (#238): exercises without their answers; an answer is
// checked here and the right one shown after it — a training, not a homework.
const word = z.object({ id: z.uuid(), word: z.string(), translation: z.string().nullable(), example: z.string().nullable() }).strict();
const exercise = z
  .object({ wordId: z.uuid(), type: z.enum(EXERCISE_TYPES), prompt: z.string(), options: z.array(z.string()).nullable() })
  .strict();

export const studentVocabularyRouter = router({
  /** The student's words, newest first. */
  words: studentProcedure.output(z.array(word)).query(({ ctx }) => wordsForStudent(ctx.db, ctx.teacherId, ctx.studentId)),

  /** How many words are due today, for «Слов на сегодня». */
  dueToday: studentProcedure.output(z.object({ count: z.number().int() }).strict()).query(async ({ ctx }) => ({
    count: await dueToday(ctx.db, ctx.teacherId, ctx.studentId),
  })),

  /** Today's training, or with `extra` («Ещё разок») random words: one exercise per word. */
  training: studentProcedure
    .input(z.object({ extra: z.boolean() }))
    .output(z.array(exercise))
    .query(({ ctx, input }) => trainingSession(ctx.db, ctx.teacherId, ctx.studentId, input.extra)),

  /** One answer, checked: whether it was right and the right answer. */
  answer: studentProcedure
    .input(z.object({ wordId: z.uuid(), type: z.enum(EXERCISE_TYPES), answer: z.string().max(200), extra: z.boolean() }))
    .output(z.object({ right: z.boolean(), correct: z.string() }).strict())
    .mutation(async ({ ctx, input }) => {
      const checked = await answerExercise(ctx.db, ctx.teacherId, ctx.studentId, input);
      if (!checked) throw new TRPCError({ code: "NOT_FOUND" });
      return checked;
    }),
});
