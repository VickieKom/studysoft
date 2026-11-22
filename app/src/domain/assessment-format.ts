// Assessment format, version 1 (docs/assessment-format.md): the monthly
// skills assessment (#252), six sections in a fixed order. Validates what the
// teacher imports on the card and, later, what the assistant saves (#313).
// The keys stay on the server: `assessmentView` is what a screen gets. Plain
// data and zod only.
import { z } from "zod";
import { SKILL_LABELS } from "./progress";

export const ASSESSMENT_FORMAT_VERSION = 1;

/** The sections in the order the child takes them; a section may be absent (#252). */
export const ASSESSMENT_SECTIONS = ["listening", "reading", "grammar", "vocabulary", "writing", "speaking"] as const;
export type AssessmentSkill = (typeof ASSESSMENT_SECTIONS)[number];

// The form's counts are upper limits, so «Убрать» keeps a draft valid (product owner, 2026-11-22).
export const MAX_LISTENING_QUESTIONS = 5;
export const MAX_READING_QUESTIONS = 5;
export const MAX_GRAMMAR_GAPS = 6;
export const MAX_VOCABULARY_QUESTIONS = 10;
export const MAX_SPEAKING_QUESTIONS = 5;
/** The reading text: the form asks 120–200 words; the format takes a little either side. */
export const READING_WORDS = { min: 80, max: 250 } as const;

export const GAP = "___";
const gapCount = (value: string) => value.split(GAP).length - 1;
const wordCount = (value: string) => value.split(/\s+/).filter(Boolean).length;

const text = z.string().trim().min(1);
const line = text.max(500);
const variants = z.array(text).min(1);
const prompt = line.optional();
const choice = z.array(line).min(3).max(4);
const vocabularyWord = z.uuid().optional();

const choiceQuestion = z
  .object({ question: line, options: choice, answer: z.number().int().min(0) })
  .strict()
  .refine((q) => q.answer < q.options.length, { path: ["answer"], message: "нет варианта с таким номером" });

export const TRUE_FALSE = ["true", "false", "not_given"] as const;
export const TRUE_FALSE_LABELS: Record<(typeof TRUE_FALSE)[number], string> = { true: "Верно", false: "Неверно", not_given: "Не сказано" };

const listening = z
  .object({ skill: z.literal("listening"), prompt, questions: z.array(choiceQuestion).min(1).max(MAX_LISTENING_QUESTIONS) })
  .strict();

const readingQuestion = z.discriminatedUnion("type", [
  z.object({ type: z.literal("true_false"), statement: line, answer: z.enum(TRUE_FALSE) }).strict(),
  z
    .object({ type: z.literal("choice"), question: line, options: choice, answer: z.number().int().min(0) })
    .strict()
    .refine((q) => q.answer < q.options.length, { path: ["answer"], message: "нет варианта с таким номером" }),
]);

const reading = z
  .object({
    skill: z.literal("reading"),
    prompt,
    text: text.max(2000).refine((t) => wordCount(t) >= READING_WORDS.min && wordCount(t) <= READING_WORDS.max, {
      error: `текст на ${READING_WORDS.min}–${READING_WORDS.max} слов`,
    }),
    questions: z.array(readingQuestion).min(1).max(MAX_READING_QUESTIONS),
  })
  .strict();

const grammarGap = z
  .object({ options: z.array(line).min(2).max(4), answer: z.number().int().min(0) })
  .strict()
  .refine((g) => g.answer < g.options.length, { path: ["answer"], message: "нет варианта с таким номером" });

const grammar = z
  .object({ skill: z.literal("grammar"), prompt, text: text.max(2000), gaps: z.array(grammarGap).min(1).max(MAX_GRAMMAR_GAPS) })
  .strict()
  .refine((s) => gapCount(s.text) === s.gaps.length, { path: ["gaps"], message: "столько же пропусков, сколько ___ в тексте" });

// A «Лексика» question may name the vocabulary word it asks, as «Из словаря» tasks do (#281), for #253.
const vocabularyQuestion = z.discriminatedUnion("type", [
  z.object({ type: z.literal("translation"), translation: line, answers: variants, vocabularyWord }).strict(),
  z
    .object({ type: z.literal("sentence"), text: line, answers: variants, vocabularyWord })
    .strict()
    .refine((q) => gapCount(q.text) === 1, { path: ["text"], message: "один пропуск ___ в предложении" }),
]);

const vocabulary = z
  .object({ skill: z.literal("vocabulary"), prompt, questions: z.array(vocabularyQuestion).min(1).max(MAX_VOCABULARY_QUESTIONS) })
  .strict();

const writing = z.object({ skill: z.literal("writing"), prompt, task: text.max(1000) }).strict();

const speaking = z
  .object({ skill: z.literal("speaking"), prompt, questions: z.array(line).min(1).max(MAX_SPEAKING_QUESTIONS) })
  .strict();

const sectionSchema = z.discriminatedUnion("skill", [listening, reading, grammar, vocabulary, writing, speaking]);

export const assessmentSchema = z
  .object({
    version: z.literal(ASSESSMENT_FORMAT_VERSION),
    title: text.max(200),
    sections: z.array(sectionSchema).min(1).max(ASSESSMENT_SECTIONS.length),
  })
  .strict()
  .refine((a) => new Set(a.sections.map((s) => s.skill)).size === a.sections.length, {
    path: ["sections"],
    message: "каждый раздел — не больше одного раза",
  })
  // Stored and shown in the format's order, whatever the order in the JSON.
  .transform((a) => ({ ...a, sections: [...a.sections].sort((x, y) => ASSESSMENT_SECTIONS.indexOf(x.skill) - ASSESSMENT_SECTIONS.indexOf(y.skill)) }));

export type AssessmentDocument = z.infer<typeof assessmentSchema>;
export type AssessmentSection = AssessmentDocument["sections"][number];

/** The sections whose questions the teacher may remove one by one; the grammar text and the writing task stay whole. */
export const REMOVABLE_SECTIONS = ["listening", "reading", "vocabulary", "speaking"] as const satisfies readonly AssessmentSkill[];
export type RemovableSkill = (typeof REMOVABLE_SECTIONS)[number];

/** The questions of a section the teacher may remove one by one, or null. */
function questionsOf(section: AssessmentSection): unknown[] | null {
  return (REMOVABLE_SECTIONS as readonly string[]).includes(section.skill) ? (section as { questions: unknown[] }).questions : null;
}

/**
 * The assessment without one question (#252, «Убрать»). A section left with
 * no question goes too. Null when there is no such question, or it is the
 * last question of the assessment.
 */
export function withoutQuestion(document: AssessmentDocument, skill: AssessmentSkill, index: number): AssessmentDocument | null {
  const section = document.sections.find((s) => s.skill === skill);
  const questions = section ? questionsOf(section) : null;
  if (!section || !questions || !Number.isInteger(index) || index < 0 || index >= questions.length) return null;
  const rest = questions.filter((_, i) => i !== index);
  const sections =
    rest.length > 0
      ? document.sections.map((s) => (s === section ? ({ ...section, questions: rest } as AssessmentSection) : s))
      : document.sections.filter((s) => s !== section);
  return sections.length > 0 ? { ...document, sections } : null;
}

const viewQuestionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("choice"), question: z.string(), options: z.array(z.string()) }).strict(),
  z.object({ type: z.literal("true_false"), statement: z.string() }).strict(),
  z.object({ type: z.literal("translation"), translation: z.string() }).strict(),
  z.object({ type: z.literal("sentence"), text: z.string() }).strict(),
  z.object({ type: z.literal("open"), question: z.string() }).strict(),
]);

/** A section as the child will see it: no keys, no vocabulary links. */
export const assessmentSectionViewSchema = z
  .object({
    skill: z.enum(ASSESSMENT_SECTIONS),
    prompt: z.string().nullable(),
    text: z.string().nullable(),
    gaps: z.array(z.array(z.string())).nullable(),
    task: z.string().nullable(),
    questions: z.array(viewQuestionSchema),
    removable: z.boolean(),
  })
  .strict();
export type AssessmentSectionView = z.infer<typeof assessmentSectionViewSchema>;

/** The assessment as the child will see it, section by section (#252): what screens get, never the keys. */
export function assessmentView(document: AssessmentDocument): AssessmentSectionView[] {
  return document.sections.map((section) => {
    const base = { skill: section.skill, prompt: section.prompt ?? null, text: null, gaps: null, task: null, removable: questionsOf(section) !== null };
    switch (section.skill) {
      case "listening":
        return { ...base, questions: section.questions.map((q) => ({ type: "choice" as const, question: q.question, options: q.options })) };
      case "reading":
        return {
          ...base,
          text: section.text,
          questions: section.questions.map((q) =>
            q.type === "true_false" ? { type: "true_false" as const, statement: q.statement } : { type: "choice" as const, question: q.question, options: q.options },
          ),
        };
      case "grammar":
        return { ...base, text: section.text, gaps: section.gaps.map((g) => g.options), questions: [] };
      case "vocabulary":
        return {
          ...base,
          questions: section.questions.map((q) =>
            q.type === "translation" ? { type: "translation" as const, translation: q.translation } : { type: "sentence" as const, text: q.text },
          ),
        };
      case "writing":
        return { ...base, task: section.task, questions: [] };
      case "speaking":
        return { ...base, questions: section.questions.map((question) => ({ type: "open" as const, question })) };
    }
  });
}

/** Whether the assessment has a section the recording is for. */
export const needsRecording = (document: AssessmentDocument) => document.sections.some((s) => s.skill === "listening");

/** The section's heading: «Аудирование», «Чтение»… */
export const sectionLabel = (skill: AssessmentSkill) => SKILL_LABELS[skill];

/** The place a field names, as the teacher reads it: «вопрос 2, поле answers», «пропуск 3, поле answer». */
function place(rest: PropertyKey[]): string {
  const [field, index, ...inner] = rest;
  const tail = inner.length > 0 ? `поле ${inner.join(".")}` : null;
  if (field === "questions" && typeof index === "number") return [`вопрос ${index + 1}`, tail].filter(Boolean).join(", ");
  if (field === "gaps" && typeof index === "number") return [`пропуск ${index + 1}`, tail].filter(Boolean).join(", ");
  return `поле ${rest.length > 0 ? rest.join(".") : "skill"}`;
}

/** One readable line per problem: which section, which question, which field, what is wrong. */
function describe(issue: z.core.$ZodIssue, input: unknown): string {
  const [first, index, ...rest] = issue.path;
  if (first === "version") return `Поле version: поддерживается версия ${ASSESSMENT_FORMAT_VERSION}`;
  if (first === "sections" && typeof index === "number") {
    const skill = (input as { sections?: { skill?: unknown }[] })?.sections?.[index]?.skill;
    const known = (ASSESSMENT_SECTIONS as readonly unknown[]).includes(skill);
    if (!known) return `Раздел ${index + 1}: неизвестный раздел «${String(skill)}»; возможные: ${ASSESSMENT_SECTIONS.join(", ")}`;
    return `${sectionLabel(skill as AssessmentSkill)}, ${place(rest)}: ${issue.message}`;
  }
  return `Поле ${issue.path.length > 0 ? issue.path.join(".") : "документ"}: ${issue.message}`;
}

const ru = z.locales.ru();

export type AssessmentParseResult = { ok: true; assessment: AssessmentDocument } | { ok: false; errors: string[] };

/** Parses pasted JSON text and validates it against the format. */
export function parseAssessment(json: string): AssessmentParseResult {
  let input: unknown;
  try {
    input = JSON.parse(json);
  } catch {
    return { ok: false, errors: ["Это не JSON: проверьте скобки, кавычки и запятые"] };
  }
  return validateAssessment(input);
}

/** Validates an assessment already parsed. */
export function validateAssessment(input: unknown): AssessmentParseResult {
  const result = assessmentSchema.safeParse(input, { error: ru.localeError });
  if (result.success) return { ok: true, assessment: result.data };
  return { ok: false, errors: result.error.issues.slice(0, 10).map((issue) => describe(issue, input)) };
}
