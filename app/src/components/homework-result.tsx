import { tasksLabel } from "@/domain/homework";

/**
 * The screen after «Сдать» (#34): praise and the score, never which tasks
 * were wrong — the mistakes are for the lesson. Written, voice and file
 * answers are counted apart: the teacher checks them (#35).
 */
export function HomeworkResult({
  firstName,
  correct,
  wrong,
  pending,
}: {
  firstName: string;
  correct: number;
  wrong: number;
  pending: number;
}) {
  return (
    <main className="flex flex-col gap-6 text-center">
      <h1 className="text-task-title font-bold">Домашка сдана!</h1>
      <div className="flex flex-col gap-2 rounded-task border border-border bg-accent-50 px-6 py-10">
        <p className="text-answer font-semibold text-accent-900">Молодец, {firstName}!</p>
        <p className="text-answer text-accent-900">
          {correct} верно, {wrong} неверно
        </p>
        {pending > 0 && <p className="text-answer text-accent-900">{tasksLabel(pending)} проверит учитель</p>}
      </div>
      <p className="text-text-secondary">Ошибки разберём вместе на уроке</p>
    </main>
  );
}
