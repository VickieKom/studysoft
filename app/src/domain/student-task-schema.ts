// What a student gets of a task (#34): studentView() as the output schema of a
// procedure, strict and without keys. Its files go out as the addresses they
// are served at, under `files`: a homework's (#33) or, for the teacher's view
// of the task bank as the child sees it, the bank's (#224). Plain zod only.
import { z } from "zod";

/** A task's video as it plays (#330): a library video's own file, a YouTube player (#325) or a link. */
export const taskVideoSchema = z
  .object({
    title: z.string(),
    file: z.string().startsWith("/api/files/library/").optional(),
    embed: z.url({ protocol: /^https$/ }).optional(),
    link: z.url({ protocol: /^https?$/ }).optional(),
  })
  .strict();

export function studentTaskSchema(files: string) {
  const text = z.string();
  // A picture goes out as the address it is served at, never as the stored reference.
  const image = z.string().startsWith(files).optional();
  // The reading text and the example of a workbook exercise (#131): part of the exercise, not keys.
  const parts = {
    passage: text.optional(),
    example: z.object({ text, answer: text.optional() }).strict().optional(),
    // The video the task is about (#330): a library file, a YouTube player or a link.
    video: taskVideoSchema.optional(),
  };
  // A recording to listen to (#127), by its address as a picture is.
  const audio = z.string().startsWith(files).optional();
  const picture = z.string().startsWith(files);
  const otherTask = z.discriminatedUnion("type", [
    z
      .object({
        type: z.enum(["single_choice", "multiple_choice"]),
        prompt: text,
        // An option is text, or pictures by their addresses with an optional caption (#129).
        options: z.array(z.union([text, z.object({ images: z.array(picture).min(1), text: text.optional() }).strict()])),
        image,
        audio,
        ...parts,
      })
      .strict(),
    z
      .object({
        type: z.literal("gap"),
        prompt: text,
        text,
        options: z.array(text).optional(),
        // A gap's own options (#128): what the student picks from, never which is right.
        choices: z.array(z.array(text).nullable()).optional(),
        // A picture by each gap, by its address (#181).
        gapImages: z.array(picture.nullable()).optional(),
        image,
        audio,
        ...parts,
      })
      .strict(),
    z
      .object({
        type: z.literal("match"),
        prompt: text,
        left: z.array(text),
        right: z.array(text),
        // The pictures on the left, by their addresses (#184).
        leftImages: z.array(z.array(picture).nullable()).optional(),
        image,
        audio,
        ...parts,
      })
      .strict(),
    z
      .object({
        type: z.literal("table"),
        prompt: text,
        // The header: text, or pictures by their addresses with an optional caption (#186).
        header: z.array(z.union([z.string(), z.object({ images: z.array(picture).min(1), text: text.optional() }).strict()])),
        // The body: text, or a blank to fill without its key.
        rows: z.array(z.array(z.union([z.string(), z.object({ blank: z.enum(["text", "mark"]) }).strict()]))),
        image,
        audio,
        ...parts,
      })
      .strict(),
    z.object({ type: z.enum(["written", "voice"]), prompt: text, hint: text.optional(), image, audio, ...parts }).strict(),
    z
      .object({
        type: z.literal("file"),
        prompt: text,
        accept: z.array(z.enum(["image", "audio"])),
        hint: text.optional(),
        image,
        audio,
        ...parts,
      })
      .strict(),
  ]);
  // An order task: one sentence in `words`, or several in `sentences`, each shuffled (#161).
  return z.union([
    otherTask,
    z.object({ type: z.literal("order"), prompt: text, words: z.array(text), image, audio, ...parts }).strict(),
    z.object({ type: z.literal("order"), prompt: text, sentences: z.array(z.array(text)), image, audio, ...parts }).strict(),
  ]);
}
