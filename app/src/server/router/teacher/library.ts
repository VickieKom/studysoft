import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  AGE_GROUPS,
  type AgeGroup,
  MATERIAL_KINDS,
  MAX_GAME_BYTES,
  MAX_TITLE_LENGTH,
  MAX_TOPIC_LENGTH,
} from "../../../domain/library";
import { LEVELS } from "../../../domain/student";
import {
  createGame,
  deleteMaterial,
  findMaterial,
  listMaterials,
  type Material,
  materialTopics,
  updateMaterial,
} from "../../library/library";
import { router, teacherProcedure } from "../core/trpc";

const notFound = () => new TRPCError({ code: "NOT_FOUND" });

const tags = z.object({
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
  level: z.enum(LEVELS),
  topic: z
    .string()
    .trim()
    .max(MAX_TOPIC_LENGTH)
    .transform((t) => (t === "" ? null : t)),
  ageGroup: z.enum(AGE_GROUPS),
});

const material = z
  .object({
    id: z.uuid(),
    kind: z.enum(MATERIAL_KINDS),
    title: z.string(),
    level: z.enum(LEVELS),
    topic: z.string().nullable(),
    ageGroup: z.enum(AGE_GROUPS),
    fileUrl: z.string(),
  })
  .strict();

const output = (m: Material) => ({
  id: m.id,
  kind: m.kind,
  title: m.title,
  level: m.level,
  topic: m.topic,
  ageGroup: m.ageGroup as AgeGroup,
  fileUrl: `/api/files/library/${m.id}`,
});

/** «Библиотека» (#115): the teacher's games; warm-ups and videos come next. */
export const libraryRouter = router({
  list: teacherProcedure
    .input(
      z.object({
        kind: z.enum(MATERIAL_KINDS).optional(),
        level: z.enum(LEVELS).optional(),
        topic: z.string().max(MAX_TOPIC_LENGTH).optional(),
        ageGroup: z.enum(AGE_GROUPS).optional(),
      }),
    )
    .output(z.object({ materials: z.array(material), topics: z.array(z.string()), total: z.number().int() }).strict())
    .query(async ({ ctx, input }) => ({
      materials: (await listMaterials(ctx.db, ctx.teacherId, input)).map(output),
      topics: await materialTopics(ctx.db, ctx.teacherId),
      total: (await listMaterials(ctx.db, ctx.teacherId, {})).length,
    })),

  get: teacherProcedure
    .input(z.object({ id: z.uuid() }))
    .output(material)
    .query(async ({ ctx, input }) => {
      const found = await findMaterial(ctx.db, ctx.teacherId, input.id);
      if (!found) throw notFound();
      return output(found);
    }),

  /** A game: one HTML file as text, at most 5 MB. */
  addGame: teacherProcedure
    .input(tags.extend({ html: z.string().max(MAX_GAME_BYTES) }))
    .output(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { html, ...rest } = input;
      const created = await createGame(ctx.db, ctx.teacherId, rest, new TextEncoder().encode(html));
      if (created === "too_big") throw new TRPCError({ code: "BAD_REQUEST", message: "Файл больше 5 МБ" });
      if (created === "not_html")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Это не HTML-страница: нужна игра одним файлом .html" });
      return created;
    }),

  update: teacherProcedure
    .input(tags.extend({ id: z.uuid() }))
    .output(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input;
      if (!(await updateMaterial(ctx.db, ctx.teacherId, id, rest))) throw notFound();
      return { id };
    }),

  remove: teacherProcedure
    .input(z.object({ id: z.uuid() }))
    .output(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await deleteMaterial(ctx.db, ctx.teacherId, input.id))) throw notFound();
      return { id: input.id };
    }),
});
