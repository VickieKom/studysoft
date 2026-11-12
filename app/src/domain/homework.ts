// Labels and formatting for homework, shared by the workspace and the
// student's page. Plain data only.

export const HOMEWORK_STATUS_LABELS = {
  draft: "Черновик",
  published: "Опубликована",
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

/** A deadline is a calendar date with no time: "14 ноября", the same in every time zone. */
export function formatDueDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
}

/** "1 задание", "3 задания", "8 заданий". */
export function tasksLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word =
    mod10 === 1 && mod100 !== 11 ? "задание" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "задания" : "заданий";
  return `${count} ${word}`;
}
