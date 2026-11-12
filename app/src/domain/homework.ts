// Labels and formatting for homework, shared by the workspace and the
// student's page. Plain data only.
import type { Task } from "./homework-format";

export const HOMEWORK_STATUS_LABELS = {
  draft: "Черновик",
  published: "Опубликована",
  submitted: "Сдана",
  missed: "Не сдана",
} as const;

export const TASK_TYPE_LABELS = {
  single_choice: "Выбор одного ответа",
  multiple_choice: "Выбор нескольких ответов",
  gap: "Вставить слово",
  match: "Соединить пары",
  order: "Порядок слов",
  written: "Письменный ответ",
  voice: "Голосовой ответ",
  file: "Фото или аудио",
} as const;

// The weekday as it reads after «к»: "к четвергу", "к среде". Index = getUTCDay().
const WEEKDAY_AFTER_K = ["воскресенью", "понедельнику", "вторнику", "среде", "четвергу", "пятнице", "субботе"];

/**
 * A deadline is a calendar date with no time, the same in every time zone.
 * Written to follow «к»: "четвергу, 14 ноября" for "Домашка к четвергу, 14 ноября".
 */
export function formatDueDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  const dayMonth = date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
  return `${WEEKDAY_AFTER_K[date.getUTCDay()]}, ${dayMonth}`;
}

/**
 * The key of a task as the teacher reads it in the preview, or null for a task
 * the teacher checks. Never shown to a student (AGENTS.md, rule 4).
 */
export function answerKey(task: Task): string | null {
  switch (task.type) {
    case "single_choice":
      return task.options[task.answer] ?? null;
    case "multiple_choice":
      return task.answers.map((i) => task.options[i]).join(", ");
    case "gap":
      return task.answers.map((variants) => variants.join(" / ")).join("; ");
    case "match":
      return task.pairs.map((p) => `${p.left} — ${p.right}`).join("; ");
    case "order":
      return [task.words, ...(task.alternatives ?? [])].map((words) => words.join(" ")).join(" / ");
    case "written":
    case "voice":
    case "file":
      return null;
  }
}

/** "1 задание", "3 задания", "8 заданий". */
export function tasksLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word =
    mod10 === 1 && mod100 !== 11 ? "задание" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "задания" : "заданий";
  return `${count} ${word}`;
}
