import { z } from "zod";
import { wordsForStudent } from "../../crm/vocabulary";
import { router, studentProcedure } from "../core/trpc";

// «Тренировка слов» behind the student's link (#236): their own words only,
// with the translation and example the teacher keeps; nothing else of the card.
const word = z.object({ id: z.uuid(), word: z.string(), translation: z.string().nullable(), example: z.string().nullable() }).strict();

export const studentVocabularyRouter = router({
  /** The student's words, newest first. */
  words: studentProcedure.output(z.array(word)).query(({ ctx }) => wordsForStudent(ctx.db, ctx.teacherId, ctx.studentId)),
});
