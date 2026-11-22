// The intro's brief (#339): the teacher's template of questions and the
// brief filled in on a request. Shared by the screens and the server's
// validation. Plain data, zod and pure functions only.
import { z } from "zod";
import { TIME_ZONE_IDS } from "./student";

export const MAX_BRIEF_QUESTIONS = 20;
export const MAX_BRIEF_OPTIONS = 12;
export const MAX_BRIEF_TEXT = 100;
export const MAX_BRIEF_NOTE = 1000;
export const MAX_TIME_RANGES = 6;

/** The keys of the starting set's questions, so #340 can carry them into the student's card. */
export const BRIEF_KEYS = ["goals", "expectations", "measure", "pains", "school", "interests"] as const;
export type BriefKey = (typeof BRIEF_KEYS)[number];

const text = z.string().trim().min(1).max(MAX_BRIEF_TEXT);

export const briefQuestionSchema = z
  .object({
    id: z.string().min(1).max(40),
    /** One of the starting set's, or none for the teacher's own question. */
    key: z.enum(BRIEF_KEYS).nullable(),
    text,
    options: z.array(text).max(MAX_BRIEF_OPTIONS),
  })
  .strict();
export type BriefQuestion = z.infer<typeof briefQuestionSchema>;
export const briefTemplateSchema = z.array(briefQuestionSchema).max(MAX_BRIEF_QUESTIONS);

/** The platform's starting set (#339): each with quick choices; «другое» is always there, as the note. */
export const STARTING_BRIEF: BriefQuestion[] = [
  { id: "goals", key: "goals", text: "Цели", options: ["Разговорный английский", "Оценки в школе", "Экзамен", "Путешествия"] },
  { id: "expectations", key: "expectations", text: "Ожидания", options: ["Регулярные занятия", "Домашние задания", "Игровой формат"] },
  { id: "measure", key: "measure", text: "Главная метрика", options: ["Оценка в школе", "Говорит свободнее", "Сдал экзамен"] },
  { id: "pains", key: "pains", text: "Боли", options: ["Стесняется говорить", "Не понимает грамматику", "Скучно на уроках"] },
  { id: "school", key: "school", text: "Проблемы в школе", options: ["Низкие оценки", "Не успевает за классом", "Нет проблем"] },
  { id: "interests", key: "interests", text: "Интересы ребёнка", options: ["Игры", "Мультфильмы", "Спорт", "Музыка"] },
];

/** «Удобное время»: always in the brief, outside the template — days and time ranges in the family's time zone. */
export const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const convenientTimeSchema = z
  .object({
    timeZone: z.enum(TIME_ZONE_IDS),
    days: z.array(z.enum(WEEKDAYS)).max(7),
    ranges: z
      .array(z.object({ from: time, to: time }).strict().refine((r) => r.from < r.to, { message: "«До» позже «С»" }))
      .max(MAX_TIME_RANGES),
  })
  .strict();
export type ConvenientTime = z.infer<typeof convenientTimeSchema>;

/** One question's answer: the ticked choices (several at once, product owner 2026-11-23) and a short note. */
export const briefAnswerSchema = z.object({ choices: z.array(text).max(MAX_BRIEF_OPTIONS), note: z.string().max(MAX_BRIEF_NOTE) }).strict();
export type BriefAnswer = z.infer<typeof briefAnswerSchema>;
export const briefAnswersSchema = z.record(z.string().max(40), briefAnswerSchema);
