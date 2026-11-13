// Labels and formatting for homework, shared by the workspace and the
// student's page. Plain data only.
import type { StoredAnswer, Task } from "./homework-format";

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

/** Where a task's picture is served, after a permission check (#33). */
export function homeworkImageUrl(homeworkId: string, taskIndex: number): string {
  return `/api/files/homework/${homeworkId}/${taskIndex}`;
}

/** Where the student's recording or file for a task is uploaded and served, after a permission check (#35). */
export function answerFileUrl(homeworkId: string, taskIndex: number): string {
  return `/api/files/answers/${homeworkId}/${taskIndex}`;
}

/** Today's calendar date in a time zone, as YYYY-MM-DD: what "today" is for the student. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** "1 задание", "3 задания", "8 заданий". */
export function tasksLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word =
    mod10 === 1 && mod100 !== 11 ? "задание" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "задания" : "заданий";
  return `${count} ${word}`;
}

/** A student's answer as the teacher reads it in the review (#36), or null when there is none. */
export function answerText(task: Task, answer: StoredAnswer | null): string | null {
  if (!answer || answer.type !== task.type) return null;
  switch (answer.type) {
    case "single_choice":
      return task.type === "single_choice" ? (task.options[answer.choice] ?? null) : null;
    case "multiple_choice":
      return task.type === "multiple_choice" ? answer.choices.map((i) => task.options[i]).join(", ") : null;
    case "gap":
      return answer.gaps.map((gap) => gap.trim() || "…").join("; ");
    case "match":
      return answer.pairs.map((p) => `${p.left} — ${p.right}`).join("; ");
    case "order":
      return answer.words.join(" ");
    case "written":
      return answer.text.trim() || null;
    // shortcut: the review names a recording or a file but does not play or show it, until the review plays them (#93)
    case "voice":
      return "Голосовая запись";
    case "file":
      return answer.contentType.startsWith("image/") ? "Фото" : "Аудиофайл";
  }
}

/** When a homework was submitted, for the teacher: "12 ноября". */
export function formatReviewDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}
