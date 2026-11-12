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

const common = {
  prompt: text,
  topic: z.string().optional(),
  skill: z.enum(SKILLS).optional(),
  source: source.optional(),
  // Images arrive with #33; until then a task that names one is refused.
  image: z.never({ error: "картинки появятся позже (#33), уберите поле image" }).optional(),
};

const singleChoice = z
  .object({ ...common, type: z.literal("single_choice"), options: z.array(text).min(2).max(8), answer: z.number().int().min(0) })
  .strict()
  .refine((t) => t.answer < t.options.length, { path: ["answer"], message: "нет варианта с таким номером" });

const multipleChoice = z
  .object({
    ...common,
    type: z.literal("multiple_choice"),
    options: z.array(text).min(2).max(8),
    answers: z.array(z.number().int().min(0)).min(1),
  })
  .strict()
  .refine((t) => t.answers.every((a) => a < t.options.length), { path: ["answers"], message: "нет варианта с таким номером" });


const gap = z
  .object({
    ...common,
    type: z.literal("gap"),
    text,
    answers: z.array(variants).min(1),
    options: z.array(text).min(2).optional(),
  })
  .strict()
  .refine((t) => gapCount(t.text) === t.answers.length, {
    path: ["answers"],
    message: "столько же списков ответов, сколько пропусков ___ в тексте",
  });

const match = z
  .object({
    ...common,
    type: z.literal("match"),
    pairs: z.array(z.object({ left: text, right: text }).strict()).min(2).max(10),
  })
  .strict();

const sameWords = (a: string[], b: string[]) => [...a].sort().join("\u0000") === [...b].sort().join("\u0000");

const order = z
  .object({
    ...common,
    type: z.literal("order"),
    words: z.array(text).min(2).max(20),
    alternatives: z.array(z.array(text)).optional(),
  })
  .strict()
  .refine((t) => (t.alternatives ?? []).every((alt) => sameWords(alt, t.words)), {
    path: ["alternatives"],
    message: "в другом порядке должны быть те же слова",
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

/** One readable line per problem: which task, which field, what is wrong. */
function describe(issue: z.core.$ZodIssue, input: unknown): string {
  const [first, index, ...rest] = issue.path;
  if (first === "tasks" && typeof index === "number") {
    const field = rest.length > 0 ? rest.join(".") : "type";
    // The teacher reads these messages; zod's own are in English.
    let message = issue.message;
    if (issue.code === "invalid_union" && (rest.length === 0 || rest.join(".") === "type")) {
      const tasks = (input as { tasks?: { type?: unknown }[] })?.tasks;
      message = `неизвестный тип «${String(tasks?.[index]?.type)}»; возможные: ${TASK_TYPES.join(", ")}`;
    }
    return `Задание ${index + 1}, поле ${field}: ${message}`;
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
export type StudentTask =
  | { type: "single_choice" | "multiple_choice"; prompt: string; options: string[] }
  | { type: "gap"; prompt: string; text: string; options?: string[] }
  | { type: "match"; prompt: string; left: string[]; right: string[] }
  | { type: "order"; prompt: string; words: string[] }
  | { type: "written" | "voice"; prompt: string; hint?: string }
  | { type: "file"; prompt: string; accept: ("image" | "audio")[]; hint?: string };

export function studentView(task: Task, seed: string): StudentTask {
  switch (task.type) {
    case "single_choice":
    case "multiple_choice":
      return { type: task.type, prompt: task.prompt, options: task.options };
    case "gap":
      return { type: "gap", prompt: task.prompt, text: task.text, ...(task.options ? { options: task.options } : {}) };
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
      return {
        type: "order",
        prompt: task.prompt,
        words: shuffled(task.words, seed, [task.words, ...(task.alternatives ?? [])]),
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

/**
 * A student's answer to an auto-checked task, as the page sends it. Choices
 * are indexes into the options; gaps, pairs and words are the values shown.
 */
export const answerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("single_choice"), choice: z.number().int().min(0) }).strict(),
  z.object({ type: z.literal("multiple_choice"), choices: z.array(z.number().int().min(0)).max(8) }).strict(),
  z.object({ type: z.literal("gap"), gaps: z.array(answerText).max(50) }).strict(),
  z
    .object({ type: z.literal("match"), pairs: z.array(z.object({ left: answerText, right: answerText }).strict()).max(10) })
    .strict(),
  z.object({ type: z.literal("order"), words: z.array(answerText).max(20) }).strict(),
]);
export type Answer = z.infer<typeof answerSchema>;

/** The number of gaps (___) in a gap task's text. */
export function gapCount(text: string): number {
  return text.split("___").length - 1;
}

/** Whether the student has given a full answer: the page warns about the others before «Сдать». */
export function isAnswered(task: StudentTask, answer: Answer | null | undefined): boolean {
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
      return task.type === "order" && answer.words.length === task.words.length;
  }
}
