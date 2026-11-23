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
import { MISTAKE_SOURCES, studentMistakes } from "../../crm/mistakes";
import { studentFeedback } from "../../homework/feedback";
import { TASK_TYPES } from "../../../domain/homework-format";
import { ALL_KINDS_ANSWER } from "../../../domain/homework";
import { createStudent, findContacts, findStudent, listStudents, saveContacts, updateStudent } from "../../crm/students";
import { addWord, confirmWordDrafts, deleteWord, draftOf, studentVocabulary, updateWord } from "../../crm/vocabulary";
import { removeFutureLessons, topUpLessons } from "../../schedule/schedule";
import { WORD_MARKS, wordMark } from "../../../domain/word-training";
import { router, teacherProcedure } from "../core/trpc";

// No format checks on names (#18): whatever the teacher types is stored as
// typed. Only an empty first name is refused. The length cap only keeps a
// request from carrying megabytes.
const MAX_NAME_LENGTH = 1000;

// A word of the student's vocabulary as the card's form sends it (#236): the word is required; an empty translation or example is none.
const wordFields = {
  word: z
    .string()
    .max(200)
    .refine((value) => !isBlank(value), { message: "the word is required" }),
  translation: z.string().max(200),
  example: z.string().max(500),
};
const duplicateWord = () => new TRPCError({ code: "CONFLICT", message: "Такое слово уже есть в словаре" });

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

  /** «Словарь» on the card (#154): the student's words, newest first, with the date each was added. */
  vocabulary: teacherProcedure
    .input(z.object({ studentId: z.uuid() }))
    .output(
      z.array(
        z
          .object({
            id: z.uuid(),
            word: z.string(),
            translation: z.string().nullable(),
            example: z.string().nullable(),
            // The assistant's proposal (#237), until the teacher confirms it.
            draft: z.object({ translation: z.string().nullable(), example: z.string().nullable() }).strict().nullable(),
            // What sticks (#240): the word's mark, and when it was last trained.
            mark: z.enum(WORD_MARKS).nullable(),
            trainedAt: z.iso.datetime().nullable(),
            addedAt: z.iso.datetime(),
          })
          .strict(),
      ),
    )
    .query(async ({ ctx, input }) => {
      if (!(await findStudent(ctx.db, ctx.teacherId, input.studentId))) throw new TRPCError({ code: "NOT_FOUND" });
      return (await studentVocabulary(ctx.db, ctx.teacherId, input.studentId)).map(
        ({ draftTranslation, draftExample, trainStep, rightCount, wrongCount, trainedAt, ...w }) => ({
          ...w,
          draft: draftOf({ draftTranslation, draftExample }),
          mark: wordMark({ step: trainStep, rightCount, wrongCount, trained: trainedAt !== null }),
          trainedAt: trainedAt?.toISOString() ?? null,
          addedAt: w.addedAt.toISOString(),
        }),
      );
    }),

  /** «Подтвердить» or «Подтвердить все» (#237): the assistant's drafts, as the page showed them, become the words' translations and examples. */
  confirmWordDrafts: teacherProcedure
    .input(
      z.object({
        studentId: z.uuid(),
        words: z.array(z.object({ id: z.uuid(), translation: z.string().nullable(), example: z.string().nullable() })).min(1).max(1000),
      }),
    )
    .output(z.object({ ok: z.literal(true) }).strict())
    .mutation(async ({ ctx, input }) => {
      if (!(await findStudent(ctx.db, ctx.teacherId, input.studentId))) throw new TRPCError({ code: "NOT_FOUND" });
      if ((await confirmWordDrafts(ctx.db, ctx.teacherId, input.studentId, input.words)) === "conflict") {
        throw new TRPCError({ code: "CONFLICT", message: "Ассистент прислал новые переводы, пока страница была открыта. Обновите страницу" });
      }
      return { ok: true as const };
    }),

  /** «Добавить слово» on the card (#236): a word by hand, with its translation and example if any. */
  addWord: teacherProcedure
    .input(z.object({ studentId: z.uuid(), ...wordFields }))
    .output(z.object({ ok: z.literal(true) }).strict())
    .mutation(async ({ ctx, input }) => {
      if (!(await findStudent(ctx.db, ctx.teacherId, input.studentId))) throw new TRPCError({ code: "NOT_FOUND" });
      const saved = await addWord(ctx.db, ctx.teacherId, input.studentId, input);
      if (saved === "duplicate") throw duplicateWord();
      return { ok: true as const };
    }),

  /** «Изменить» a word of the card's «Словарь» (#236). */
  updateWord: teacherProcedure
    .input(z.object({ studentId: z.uuid(), id: z.uuid(), ...wordFields }))
    .output(z.object({ ok: z.literal(true) }).strict())
    .mutation(async ({ ctx, input }) => {
      const saved = await updateWord(ctx.db, ctx.teacherId, input.studentId, input.id, input);
      if (saved === "not_found") throw new TRPCError({ code: "NOT_FOUND" });
      if (saved === "duplicate") throw duplicateWord();
      return { ok: true as const };
    }),

  /** «Удалить» a word of the card's «Словарь» (#236). */
  deleteWord: teacherProcedure
    .input(z.object({ studentId: z.uuid(), id: z.uuid() }))
    .output(z.object({ ok: z.literal(true) }).strict())
    .mutation(async ({ ctx, input }) => {
      if (!(await deleteWord(ctx.db, ctx.teacherId, input.studentId, input.id))) throw new TRPCError({ code: "NOT_FOUND" });
      return { ok: true as const };
    }),

  /** «Фидбэк» (#331): the child's answers to the mini-question after the homework, the newest first. */
  feedback: teacherProcedure
    .input(z.object({ studentId: z.uuid() }))
    .output(
      z.array(z.object({ homeworkTitle: z.string(), answer: z.enum([...TASK_TYPES, ALL_KINDS_ANSWER]), answeredAt: z.iso.datetime() }).strict()),
    )
    .query(async ({ ctx, input }) => {
      if (!(await findStudent(ctx.db, ctx.teacherId, input.studentId))) throw notFound();
      return (await studentFeedback(ctx.db, ctx.teacherId, input.studentId)).map((f) => ({ ...f, answeredAt: f.answeredAt.toISOString() }));
    }),

  /** «Ошибки по темам» (#119): wrong answers of homework and games over the last 30 days, by topic. */
  mistakes: teacherProcedure
    .input(z.object({ studentId: z.uuid() }))
    .output(
      z.array(
        z
          .object({
            topic: z.string(),
            count: z.number().int().min(1),
            mistakes: z.array(
              z
                .object({
                  from: z.enum(MISTAKE_SOURCES),
                  title: z.string(),
                  at: z.iso.datetime(),
                  task: z.string(),
                  answer: z.string().nullable(),
                })
                .strict(),
            ),
          })
          .strict(),
      ),
    )
    .query(async ({ ctx, input }) => {
      if (!(await findStudent(ctx.db, ctx.teacherId, input.studentId))) throw notFound();
      return (await studentMistakes(ctx.db, ctx.teacherId, input.studentId)).map((topic) => ({
        ...topic,
        mistakes: topic.mistakes.map((m) => ({ ...m, at: m.at.toISOString() })),
      }));
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
        if (!updated) return false;
        await saveContacts(tx, ctx.teacherId, id, contacts);
        // «На паузе» and «Завершили» take the future lessons off the schedule;
        // back in «Занимается» they come again from the slots (#80). Inside the
        // lock, so a week read cannot add lessons after the pause (it waits).
        if (changes.status === "paused" || changes.status === "finished") await removeFutureLessons(tx, ctx.teacherId, id);
        else await topUpLessons(tx, ctx.teacherId, new Date(), id);
        return true;
      });
      if (!saved) throw notFound();
      return { id };
    }),
});
