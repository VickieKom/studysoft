// Homework format, version 1 (docs/homework-format.md). Validates what the
// teacher pastes and, later, what the assistant saves (#43). Plain data and
// zod only, so the server and the screens can both use it.
import { z } from "zod";

export const HOMEWORK_FORMAT_VERSION = 1;
export const SKILLS = ["grammar", "vocabulary", "reading", "writing", "speaking", "listening"] as const;

const text = z.string().trim().min(1);
const variants = z.array(text).min(1);

const source = z.union([
  z.literal("own"),
  z
    .object({ book: text, unit: z.string().optional(), page: z.string().optional(), exercise: z.string().optional() })
    .strict(),
]);
/** Where a task comes from: the teacher's own, or a textbook exercise. */
export const taskSourceSchema = source;

/** The largest picture a task may carry (#33): plenty for a picture next to an exercise. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

// A picture comes in the JSON as a data URL, so one paste brings everything.
// Once saved, the platform keeps a reference to the stored file instead.
const IMAGE_DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/;
const IMAGE_REF = /^blob:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The largest recording a task may carry (#127, product owner 2026-11-18): a workbook track of a few minutes. */
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
/** The recordings a task takes, as they are stored: MP3, M4A, WAV, OGG (#127). */
export const AUDIO_TYPES = ["audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg"] as const;
export type AudioType = (typeof AUDIO_TYPES)[number];
// The names browsers and tools give these types, and the one each is stored as.
const AUDIO_ALIASES: Record<string, AudioType> = {
  "audio/mpeg": "audio/mpeg",
  "audio/mp3": "audio/mpeg",
  "audio/mp4": "audio/mp4",
  "audio/m4a": "audio/mp4",
  "audio/x-m4a": "audio/mp4",
  "audio/aac": "audio/mp4",
  "audio/wav": "audio/wav",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/ogg": "audio/ogg",
};
const AUDIO_DATA_URL = /^data:(audio\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/;

/** The type and the bytes of a recording's data URL, or null when it is not one the format accepts (#127). */
export function audioDataUrl(value: string): { type: AudioType; base64: string; bytes: number } | null {
  const match = AUDIO_DATA_URL.exec(value);
  const type = match ? AUDIO_ALIASES[match[1]!] : undefined;
  if (!match || !type) return null;
  const base64 = match[2]!;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return { type, base64, bytes: Math.floor((base64.length * 3) / 4) - padding };
}

/** The type and the bytes of a picture's data URL, or null when it is not one the format accepts. */
export function imageDataUrl(value: string): { type: ImageType; base64: string; bytes: number } | null {
  const match = IMAGE_DATA_URL.exec(value);
  if (!match) return null;
  const base64 = match[2]!;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return { type: match[1] as ImageType, base64, bytes: Math.floor((base64.length * 3) / 4) - padding };
}

/** The stored file a task's picture refers to, or null. */
export function imageRef(value: string): string | null {
  return IMAGE_REF.test(value) ? value.slice("blob:".length) : null;
}

const image = z
  .string()
  .refine((value) => imageRef(value) !== null || imageDataUrl(value) !== null, {
    error: "картинка — PNG, JPEG или WebP в виде data:image/…;base64,…",
  })
  .refine((value) => (imageDataUrl(value)?.bytes ?? 0) <= MAX_IMAGE_BYTES, { error: "картинка больше 2 МБ" });

/** The longest reading text a task carries: a page of a workbook (#131). */
export const MAX_PASSAGE_CHARS = 5000;

/**
 * A workbook exercise's example (#131): shown with its answer, marked as an
 * example, never answered or checked. In `text`, `___` stands where the
 * answer goes.
 */
const example = z.object({ text, answer: z.string().trim().min(1).optional() }).strict();
export type TaskExample = z.infer<typeof example>;

const audio = z
  .string()
  .refine((value) => imageRef(value) !== null || audioDataUrl(value) !== null, {
    error: "запись — MP3, M4A, WAV или OGG в виде data:audio/…;base64,…",
  })
  .refine((value) => (audioDataUrl(value)?.bytes ?? 0) <= MAX_AUDIO_BYTES, { error: "запись больше 10 МБ" });

const common = {
  prompt: text,
  // A reading text of its own (#131): a passage, a blog post, a dialogue, notes; shown in regular type with its lines.
  passage: z.string().trim().min(1).max(MAX_PASSAGE_CHARS).optional(),
  example: example.optional(),
  // A recording for the student to listen to (#127), stored and referred to as a picture is.
  audio: audio.optional(),
  topic: z.string().optional(),
  skill: z.enum(SKILLS).optional(),
  source: source.optional(),
  image: image.optional(),
};

/** The most pictures one answer option holds (#129). */
export const MAX_OPTION_PICTURES = 4;

// An answer option (#129): text, or one picture or more with an optional caption.
const pictureOption = z
  .object({ images: z.array(image).min(1).max(MAX_OPTION_PICTURES), text: text.optional() })
  .strict();
const option = z.union([text, pictureOption]);
export type PictureOption = z.infer<typeof pictureOption>;
export type ChoiceOption = z.infer<typeof option>;

const singleChoice = z
  .object({ ...common, type: z.literal("single_choice"), options: z.array(option).min(2).max(8), answer: z.number().int().min(0) })
  .strict()
  .refine((t) => t.answer < t.options.length, { path: ["answer"], message: "нет варианта с таким номером" });

const multipleChoice = z
  .object({
    ...common,
    type: z.literal("multiple_choice"),
    options: z.array(option).min(2).max(8),
    answers: z.array(z.number().int().min(0)).min(1),
  })
  .strict()
  .refine((t) => t.answers.every((a) => a < t.options.length), { path: ["answers"], message: "нет варианта с таким номером" });


/** How the format compares a key with a gap's own options: as typed answers are compared, ignoring case and spaces. */
const sameOption = (a: string, b: string) => a.trim().toLocaleLowerCase("en") === b.trim().toLocaleLowerCase("en");

const gap = z
  .object({
    ...common,
    type: z.literal("gap"),
    text,
    answers: z.array(variants).min(1),
    options: z.array(text).min(2).optional(),
    // A gap's own options (#128), one entry per gap in order; null for a gap the student types.
    choices: z.array(z.array(text).min(2).max(6).nullable()).optional(),
    // A picture by each gap, as a workbook prints one beside each line to label (#181); null for a gap without one.
    gapImages: z.array(image.nullable()).optional(),
  })
  .strict()
  .refine((t) => gapCount(t.text) === t.answers.length, {
    path: ["answers"],
    message: "столько же списков ответов, сколько пропусков ___ в тексте",
  })
  .refine((t) => !t.gapImages || t.gapImages.length === gapCount(t.text), {
    path: ["gapImages"],
    message: "по картинке или null на каждый пропуск ___ в тексте",
  })
  .superRefine((t, ctx) => {
    if (!t.choices) return;
    if (t.options) {
      ctx.addIssue({ code: "custom", path: ["choices"], message: "общие слова на выбор (options) и варианты у пропусков (choices) вместе не бывают" });
      return;
    }
    if (t.choices.length !== gapCount(t.text)) {
      ctx.addIssue({ code: "custom", path: ["choices"], message: "столько же элементов, сколько пропусков ___ в тексте (null — пропуск без вариантов)" });
      return;
    }
    t.choices.forEach((own, i) => {
      const missing = own ? (t.answers[i] ?? []).find((key) => !own.some((option) => sameOption(option, key))) : undefined;
      if (missing !== undefined) {
        ctx.addIssue({ code: "custom", path: ["answers", i], message: `пропуск ${i + 1}: ответа «${missing}» нет среди его вариантов` });
      }
    });
  });

const match = z
  .object({
    ...common,
    type: z.literal("match"),
    pairs: z.array(z.object({ left: text, right: text }).strict()).min(2).max(10),
  })
  .strict();

const sameWords = (a: string[], b: string[]) => [...a].sort().join("\u0000") === [...b].sort().join("\u0000");

const orderWords = z.array(text).min(2).max(20);
const sameWordsMessage = "в другом порядке должны быть те же слова";

/** One sentence of an order task of several (#161): its words in the right order and other right orders. */
const orderSentence = z
  .object({ words: orderWords, alternatives: z.array(z.array(text)).optional() })
  .strict()
  .refine((s) => (s.alternatives ?? []).every((alt) => sameWords(alt, s.words)), {
    path: ["alternatives"],
    message: sameWordsMessage,
  });

/** The most sentences one order task holds (#161): a workbook exercise's worth. */
export const MAX_ORDER_SENTENCES = 10;

// One sentence in `words`, or several in `sentences` under one instruction,
// each its own point (#161).
const order = z
  .object({
    ...common,
    type: z.literal("order"),
    words: orderWords.optional(),
    alternatives: z.array(z.array(text)).optional(),
    sentences: z.array(orderSentence).min(2).max(MAX_ORDER_SENTENCES).optional(),
  })
  .strict()
  .refine((t) => (t.words === undefined) !== (t.sentences === undefined), {
    path: ["words"],
    message: "нужно одно из двух: words — одно предложение или sentences — несколько",
  })
  .refine((t) => !t.sentences || !t.alternatives, {
    path: ["alternatives"],
    message: "у нескольких предложений другие порядки пишутся в каждом из sentences",
  })
  .refine((t) => !t.words || (t.alternatives ?? []).every((alt) => sameWords(alt, t.words!)), {
    path: ["alternatives"],
    message: sameWordsMessage,
  });

const written = z.object({ ...common, type: z.literal("written"), hint: z.string().optional() }).strict();
const voice = z.object({ ...common, type: z.literal("voice"), hint: z.string().optional() }).strict();
const file = z
  .object({
    ...common,
    type: z.literal("file"),
    accept: z.array(z.enum(["image", "audio"])).min(1).optional(),
    hint: z.string().optional(),
  })
  .strict();

export const TASK_TYPES = [
  "single_choice",
  "multiple_choice",
  "gap",
  "match",
  "order",
  "written",
  "voice",
  "file",
] as const;

export const taskSchema = z.discriminatedUnion("type", [
  singleChoice,
  multipleChoice,
  gap,
  match,
  order,
  written,
  voice,
  file,
]);

export const homeworkSchema = z
  .object({
    version: z.literal(HOMEWORK_FORMAT_VERSION),
    title: text,
    tasks: z.array(taskSchema).min(1).max(50),
  })
  .strict();

export type HomeworkDocument = z.infer<typeof homeworkSchema>;
export type Task = z.infer<typeof taskSchema>;
export type TaskType = (typeof TASK_TYPES)[number];
export type OrderTask = Extract<Task, { type: "order" }>;
export type OrderSentence = { words: string[]; alternatives?: string[][] };

/** The sentences of an order task (#161): the one in `words`, or each of `sentences`. */
export function orderSentences(task: OrderTask): OrderSentence[] {
  if (task.sentences) return task.sentences;
  return [{ words: task.words ?? [], ...(task.alternatives ? { alternatives: task.alternatives } : {}) }];
}

/**
 * How many points a task counts in the score: a sentence each for an order
 * task of several sentences (#161), one for any other task.
 */
export function taskPoints(task: Task): number {
  return task.type === "order" && task.sentences ? task.sentences.length : 1;
}

/**
 * The pictures of a task's parts (#129), in a fixed order: the pictures of
 * the answer options, option by option. Each is served at its position in
 * this list; the task's own `image` is apart. `place` names it for the
 * teacher: «вариант 2, картинка 1».
 */
export function partPictures(task: Task): { value: string; place: string }[] {
  if (task.type === "gap") {
    return (task.gapImages ?? []).flatMap((value, i) => (value ? [{ value, place: `пропуск ${i + 1}` }] : []));
  }
  if (task.type !== "single_choice" && task.type !== "multiple_choice") return [];
  return task.options.flatMap((option, i) =>
    typeof option === "string" ? [] : option.images.map((value, n) => ({ value, place: `вариант ${i + 1}, картинка ${n + 1}` })),
  );
}

/** The task with each picture of its parts replaced, by its position in partPictures(). */
export function withPartPictures<T extends { type: string; options?: unknown; gapImages?: unknown }>(
  task: T,
  replace: (value: string, n: number) => string,
): T {
  let n = 0;
  if (task.type === "gap" && Array.isArray(task.gapImages)) {
    return { ...task, gapImages: (task.gapImages as (string | null)[]).map((value) => (value ? replace(value, n++) : null)) };
  }
  if ((task.type !== "single_choice" && task.type !== "multiple_choice") || !Array.isArray(task.options)) return task;
  const options = (task.options as ChoiceOption[]).map((option) =>
    typeof option === "string" ? option : { ...option, images: option.images.map((value) => replace(value, n++)) },
  );
  return { ...task, options };
}

/**
 * An option that is neither text nor pictures fails as a union: the problem
 * worth saying is the one inside the branch the value was meant for (#129).
 */
function innermost(issue: z.core.$ZodIssue): z.core.$ZodIssue {
  if (issue.code !== "invalid_union" || issue.errors.length === 0) return issue;
  const meant = issue.errors.find((branch) => !branch.every((i) => i.code === "invalid_type" && i.path.length === 0));
  const inner = meant?.[0];
  return inner ? innermost({ ...inner, path: [...issue.path, ...inner.path] }) : issue;
}

/** The place a field names, as the teacher reads it: «вариант 2, картинка 1» for options.1.images.0. */
function place(rest: PropertyKey[]): string {
  const [field, option, part, picture] = rest;
  if (field === "gapImages" && typeof option === "number") return `пропуск ${option + 1}`;
  if (field === "options" && typeof option === "number") {
    if (part === "images" && typeof picture === "number") return `вариант ${option + 1}, картинка ${picture + 1}`;
    return `вариант ${option + 1}`;
  }
  return `поле ${rest.length > 0 ? rest.join(".") : "type"}`;
}

/** One readable line per problem: which task, which field, what is wrong. */
function describe(found: z.core.$ZodIssue, input: unknown): string {
  const [, , ...inner] = found.path;
  const issue = inner.length > 0 ? innermost(found) : found;
  const [first, index, ...rest] = issue.path;
  if (first === "tasks" && typeof index === "number") {
    const field = place(rest);
    // The teacher reads these messages; zod's own are in English.
    let message = issue.message;
    if (issue.code === "invalid_union" && (rest.length === 0 || rest.join(".") === "type")) {
      const tasks = (input as { tasks?: { type?: unknown }[] })?.tasks;
      message = `неизвестный тип «${String(tasks?.[index]?.type)}»; возможные: ${TASK_TYPES.join(", ")}`;
    }
    return `Задание ${index + 1}, ${field}: ${message}`;
  }
  const field = issue.path.length > 0 ? issue.path.join(".") : "документ";
  if (first === "version") return `Поле version: поддерживается версия ${HOMEWORK_FORMAT_VERSION}`;
  return `Поле ${field}: ${issue.message}`;
}

/** zod messages in Russian, for whoever reads the import errors. */
const ru = z.locales.ru();

export type ParseResult = { ok: true; homework: HomeworkDocument } | { ok: false; errors: string[] };

/** Parses pasted JSON text and validates it against the format. */
export function parseHomework(json: string): ParseResult {
  let input: unknown;
  try {
    input = JSON.parse(json);
  } catch {
    return { ok: false, errors: ["Это не JSON: проверьте скобки, кавычки и запятые"] };
  }
  return validateHomework(input);
}

/** Validates a homework already parsed, as the draft editor sends it (#37). */
export function validateHomework(input: unknown): ParseResult {
  const result = homeworkSchema.safeParse(input, { error: ru.localeError });
  if (result.success) return { ok: true, homework: result.data };
  return { ok: false, errors: result.error.issues.slice(0, 10).map((issue) => describe(issue, input)) };
}

/**
 * A shuffle that gives the same order for the same seed, so the student sees
 * the tiles in one order on every visit and on every device. It never shows
 * one of the solved orders when another order exists. The seed must not be
 * guessable by the student: the server derives it from a secret.
 */
function shuffled<T>(items: readonly T[], seed: string, solved: readonly (readonly T[])[]): T[] {
  // FNV-1a over the seed, then mulberry32 as the generator.
  let state = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 0x01000193);
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  const isSolved = (order: readonly T[]) => solved.some((s) => s.length === order.length && s.every((item, i) => item === order[i]));
  // The shuffle, its rotations, then the rotations with the first two swapped:
  // the first of these that is not a solved order. For three items that is
  // every order there is; longer tasks have far more orders than solutions.
  const rotations = (order: T[]) => order.map((_, turn) => [...order.slice(turn), ...order.slice(0, turn)]);
  const swapped = result.length > 1 ? [result[1]!, result[0]!, ...result.slice(2)] : result;
  return [...rotations(result), ...rotations(swapped)].find((order) => !isSolved(order)) ?? result;
}

/**
 * What the student may see of a task: everything except the keys. The server
 * sends only this to students (AGENTS.md, rule 4); the teacher's preview shows
 * the whole task, keys included. The right column of a match and the words of
 * an order are shuffled by the seed (the homework and the task), never left
 * in the solved order.
 */
export type StudentTask = (
  | { type: "single_choice" | "multiple_choice"; prompt: string; options: ChoiceOption[] }
  | { type: "gap"; prompt: string; text: string; options?: string[]; choices?: (string[] | null)[]; gapImages?: (string | null)[] }
  | { type: "match"; prompt: string; left: string[]; right: string[] }
  | { type: "order"; prompt: string; words: string[] }
  | { type: "order"; prompt: string; sentences: string[][] }
  | { type: "written" | "voice"; prompt: string; hint?: string }
  | { type: "file"; prompt: string; accept: ("image" | "audio")[]; hint?: string }
) & {
  /** The address of the task's picture, served after a permission check (#33). */
  image?: string;
  /** The reading text and the example (#131): part of the exercise, not keys. */
  passage?: string;
  example?: TaskExample;
  /** The address of the task's recording (#127), served the same way. */
  audio?: string;
};

export function studentView(task: Task, seed: string): StudentTask {
  const parts = { ...(task.passage ? { passage: task.passage } : {}), ...(task.example ? { example: task.example } : {}) };
  return { ...studentBody(task, seed), ...parts };
}

function studentBody(task: Task, seed: string): StudentTask {
  switch (task.type) {
    case "single_choice":
    case "multiple_choice":
      return { type: task.type, prompt: task.prompt, options: task.options };
    case "gap":
      return {
        type: "gap",
        prompt: task.prompt,
        text: task.text,
        ...(task.options ? { options: task.options } : {}),
        ...(task.choices ? { choices: task.choices } : {}),
        ...(task.gapImages ? { gapImages: task.gapImages } : {}),
      };
    case "match":
      return {
        type: "match",
        prompt: task.prompt,
        left: task.pairs.map((p) => p.left),
        right: shuffled(
          task.pairs.map((p) => p.right),
          seed,
          [task.pairs.map((p) => p.right)],
        ),
      };
    case "order":
      if (task.sentences) {
        return {
          type: "order",
          prompt: task.prompt,
          sentences: task.sentences.map((s, i) => shuffled(s.words, `${seed}:${i}`, [s.words, ...(s.alternatives ?? [])])),
        };
      }
      return {
        type: "order",
        prompt: task.prompt,
        words: shuffled(task.words ?? [], seed, [task.words ?? [], ...(task.alternatives ?? [])]),
      };
    case "written":
    case "voice":
      return { type: task.type, prompt: task.prompt, ...(task.hint ? { hint: task.hint } : {}) };
    case "file":
      return {
        type: "file",
        prompt: task.prompt,
        accept: task.accept ?? ["image", "audio"],
        ...(task.hint ? { hint: task.hint } : {}),
      };
  }
}

/** The task types the student answers on the platform and the platform checks (#34). */
export const AUTO_CHECKED_TYPES = ["single_choice", "multiple_choice", "gap", "match", "order"] as const;

const answerText = z.string().max(500);

/** The longest written answer: a few paragraphs (#35). */
export const MAX_WRITTEN_CHARS = 5000;
/** The largest file a student attaches or records (#35, product owner 2026-11-12). */
export const MAX_ANSWER_FILE_BYTES = 10 * 1024 * 1024;
/** The longest voice recording, in seconds (#35, product owner 2026-11-12). */
export const MAX_VOICE_SECONDS = 5 * 60;

const pageAnswers = [
  z.object({ type: z.literal("single_choice"), choice: z.number().int().min(0) }).strict(),
  z.object({ type: z.literal("multiple_choice"), choices: z.array(z.number().int().min(0)).max(8) }).strict(),
  z.object({ type: z.literal("gap"), gaps: z.array(answerText).max(50) }).strict(),
  z
    .object({ type: z.literal("match"), pairs: z.array(z.object({ left: answerText, right: answerText }).strict()).max(10) })
    .strict(),
  // One sentence in `words`, or each sentence of a task of several in `sentences` (#161).
  z
    .object({
      type: z.literal("order"),
      words: z.array(answerText).max(20).optional(),
      sentences: z.array(z.array(answerText).max(20)).max(MAX_ORDER_SENTENCES).optional(),
    })
    .strict()
    .refine((a) => (a.words === undefined) !== (a.sentences === undefined), { message: "words или sentences" }),
  z.object({ type: z.literal("written"), text: z.string().max(MAX_WRITTEN_CHARS) }).strict(),
] as const;

/**
 * A student's answer as the page sends it. Choices are indexes into the
 * options; gaps, pairs and words are the values shown; a written answer is
 * its text. A recording or a file is never sent this way: it is uploaded to
 * its own address and the server stores the reference (#35).
 */
export const answerSchema = z.discriminatedUnion("type", [...pageAnswers]);
export type Answer = z.infer<typeof answerSchema>;

/** An answer as stored: what the page sends, or a recording or a file the server kept in the blob store. */
export const storedAnswerSchema = z.discriminatedUnion("type", [
  ...pageAnswers,
  z.object({ type: z.literal("voice"), file: z.uuid(), contentType: z.string() }).strict(),
  z.object({ type: z.literal("file"), file: z.uuid(), contentType: z.string() }).strict(),
]);
export type StoredAnswer = z.infer<typeof storedAnswerSchema>;

const answerFileUrl = z.string().startsWith("/api/files/answers/");

/** An answer as the student's page gets it back: a recording or a file by its address, never by the stored reference. */
export const studentAnswerSchema = z.discriminatedUnion("type", [
  ...pageAnswers,
  z.object({ type: z.literal("voice"), url: answerFileUrl, contentType: z.string() }).strict(),
  z.object({ type: z.literal("file"), url: answerFileUrl, contentType: z.string() }).strict(),
]);
export type StudentAnswer = z.infer<typeof studentAnswerSchema>;

/** The number of gaps (___) in a gap task's text. */
export function gapCount(text: string): number {
  return text.split("___").length - 1;
}

/** Whether the student has given a full answer: the page warns about the others before «Сдать». */
export function isAnswered(task: StudentTask, answer: StudentAnswer | null | undefined): boolean {
  if (!answer || answer.type !== task.type) return false;
  switch (answer.type) {
    case "single_choice":
      return true;
    case "multiple_choice":
      return answer.choices.length > 0;
    case "gap":
      return task.type === "gap" && answer.gaps.length === gapCount(task.text) && answer.gaps.every((g) => g.trim() !== "");
    case "match":
      return task.type === "match" && answer.pairs.length === task.left.length;
    case "order":
      if (task.type !== "order") return false;
      if ("sentences" in task)
        return (
          answer.sentences?.length === task.sentences.length &&
          task.sentences.every((words, i) => answer.sentences![i]!.length === words.length)
        );
      return answer.words?.length === task.words.length;
    case "written":
      return answer.text.trim() !== "";
    case "voice":
    case "file":
      return true;
  }
}
