import { RATED_MATERIAL_KINDS } from "../../../domain/feedback-rating";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { SKILLS, TASK_TYPES, taskSourceSchema } from "../../../domain/homework-format";
import { LEVELS, STATUSES } from "../../../domain/student";
import { buildStudentContext } from "../../crm/context";
import { findStudent, listStudents } from "../../crm/students";
import { saveWordDrafts, wordsForAgent } from "../../crm/vocabulary";
import { agentProcedure, router } from "../core/trpc";

// What the assistant sees. Strict schemas: a field added to the card does not
// reach the assistant unless it is added here on purpose (#3, #18).
const studentEntry = z.object({ id: z.uuid(), firstName: z.string(), status: z.enum(STATUSES) }).strict();

const studentContext = z
  .object({
    firstName: z.string(),
    age: z.string().nullable(),
    schoolYear: z.string().nullable(),
    level: z.enum(LEVELS),
    textbook: z.string().nullable(),
    currentUnit: z.string().nullable(),
    interests: z.string().nullable(),
    whatWorks: z.string().nullable(),
    gaps: z.string().nullable(),
    notes: z.array(z.object({ body: z.string(), createdAt: z.iso.datetime() }).strict()),
    recentHomework: z.array(
      z
        .object({
          title: z.string(),
          submittedAt: z.iso.datetime(),
          comment: z.string().nullable(),
          tasks: z.array(
            z
              .object({
                prompt: z.string(),
                type: z.enum(TASK_TYPES),
                topic: z.string().nullable(),
                source: taskSourceSchema.nullable(),
                answer: z.string().nullable(),
                correct: z.boolean().nullable(),
                markedByTeacher: z.boolean(),
                // Each sentence of an order task of several, its own point (#161).
                sentences: z
                  .array(z.object({ answer: z.string().nullable(), correct: z.boolean(), markedByTeacher: z.boolean() }).strict())
                  .optional(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    // Games the student played by their link (#119) or with the teacher in a lesson (#147): the answers as the game reported them.
    recentGames: z.array(
      z
        .object({
          title: z.string(),
          playedAt: z.iso.datetime(),
          playedWithTeacher: z.boolean(),
          answers: z.array(
            z
              .object({
                task: z.string(),
                answer: z.string(),
                correct: z.boolean(),
                topic: z.string().optional(),
                skill: z.enum(SKILLS).optional(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    mistakesByTopic: z.array(z.object({ topic: z.string(), count: z.number().int() }).strict()),
    // The student's vocabulary, the newest words first (#154).
    vocabulary: z.array(z.object({ word: z.string(), translation: z.string().nullable() }).strict()),
    // The words missed more often than not in the student's training (#240).
    weakWords: z.array(z.object({ word: z.string(), translation: z.string().nullable() }).strict()),
    // The library games made for the student (#292).
    gamesForStudent: z.array(z.object({ id: z.uuid(), title: z.string() }).strict()),
    // What the next monthly assessment is drafted from (#313): since the last approved one, or the last 30 days.
    assessmentPeriod: z
      .object({
        lastAssessmentAt: z.iso.datetime().nullable(),
        since: z.iso.datetime(),
        coveredUnits: z.array(z.object({ unit: z.string(), heldAt: z.iso.datetime() }).strict()),
        words: z.array(z.object({ id: z.uuid(), word: z.string(), translation: z.string().nullable() }).strict()),
      })
      .strict(),
    // The child's feedback (#335): «что заходит» by kind of lesson material and of homework task, «3 из 3» chosen
    // in three answers of three; the topics «Про что хочется ещё?» chose; the topics «пока путаюсь»; the latest wishes.
    feedback: z
      .object({
        lessonMaterials: z.array(z.object({ kind: z.enum(RATED_MATERIAL_KINDS), chosen: z.number().int(), of: z.number().int() }).strict()),
        // The kinds in pairs answered «Оба так себе»: `meh` such pairs of `of` the kind was in.
        lessonMaterialsMeh: z.array(z.object({ kind: z.enum(RATED_MATERIAL_KINDS), meh: z.number().int(), of: z.number().int() }).strict()),
        homeworkTasks: z.array(z.object({ kind: z.enum(TASK_TYPES), chosen: z.number().int(), of: z.number().int() }).strict()),
        topics: z.array(z.object({ topic: z.string(), chosen: z.number().int() }).strict()),
        struggling: z.array(z.string()),
        wishes: z.array(z.string()),
      })
      .strict(),
  })
  .strict();

// A word of the student's vocabulary as the assistant reads it (#237).
const agentWord = z
  .object({
    id: z.uuid(),
    word: z.string(),
    translation: z.string().nullable(),
    example: z.string().nullable(),
    draft: z.object({ translation: z.string().nullable(), example: z.string().nullable() }).strict().nullable(),
  })
  .strict();

export const agentStudentsRouter = router({
  /** Every student of the teacher, archive included, with the status to tell them apart. */
  listStudents: agentProcedure.output(z.array(studentEntry)).query(async ({ ctx }) =>
    (await listStudents(ctx.db, ctx.teacherId, STATUSES)).map((s) => ({
      id: s.id,
      firstName: s.firstName,
      status: s.status,
    })),
  ),

  studentContext: agentProcedure
    .input(z.object({ studentId: z.uuid() }))
    .output(studentContext)
    .query(async ({ ctx, input }) => {
      const context = await buildStudentContext(ctx.db, ctx.teacherId, input.studentId);
      if (!context) throw new TRPCError({ code: "NOT_FOUND" });
      return {
        ...context,
        level: context.level as (typeof LEVELS)[number],
        notes: context.notes.map((note) => ({ body: note.body, createdAt: note.createdAt.toISOString() })),
        recentHomework: context.recentHomework.map((h) => ({ ...h, submittedAt: h.submittedAt.toISOString() })),
        recentGames: context.recentGames.map((g) => ({ ...g, playedAt: g.playedAt.toISOString() })),
        assessmentPeriod: {
          ...context.assessmentPeriod,
          lastAssessmentAt: context.assessmentPeriod.lastAssessmentAt?.toISOString() ?? null,
          since: context.assessmentPeriod.since.toISOString(),
          coveredUnits: context.assessmentPeriod.coveredUnits.map((u) => ({ unit: u.unit, heldAt: u.heldAt.toISOString() })),
        },
      };
    }),

  /** The student's words with their ids, what is confirmed and the assistant's own draft (#237). */
  studentWords: agentProcedure
    .input(z.object({ studentId: z.uuid() }))
    .output(z.array(agentWord))
    .query(async ({ ctx, input }) => {
      if (!(await findStudent(ctx.db, ctx.teacherId, input.studentId))) throw new TRPCError({ code: "NOT_FOUND" });
      return wordsForAgent(ctx.db, ctx.teacherId, input.studentId);
    }),

  /**
   * Proposes translations and examples for the student's words, as drafts
   * the student does not see (#237, AGENTS.md rule 5): confirmed values stay
   * until the teacher confirms on the card. Every word must be this
   * student's, or nothing is saved.
   */
  saveWordDrafts: agentProcedure
    .input(
      z.object({
        studentId: z.uuid(),
        words: z
          .array(z.object({ wordId: z.uuid(), translation: z.string().max(200), example: z.string().max(500) }))
          .min(1)
          .max(300),
      }),
    )
    .output(z.object({ status: z.literal("draft"), count: z.number().int() }).strict())
    .mutation(async ({ ctx, input }) => {
      if (!(await findStudent(ctx.db, ctx.teacherId, input.studentId))) throw new TRPCError({ code: "NOT_FOUND" });
      if ((await saveWordDrafts(ctx.db, ctx.teacherId, input.studentId, input.words)) === "not_found") throw new TRPCError({ code: "NOT_FOUND" });
      return { status: "draft" as const, count: input.words.length };
    }),
});
