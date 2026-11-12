/**
 * The screen after «Сдать» (#34): praise and the score, never which tasks
 * were wrong — the mistakes are for the lesson.
 */
export function HomeworkResult({ firstName, correct, wrong }: { firstName: string; correct: number; wrong: number }) {
  return (
    <main className="flex flex-col gap-6 text-center">
      <h1 className="text-task-title font-bold">Домашка сдана!</h1>
      <div className="flex flex-col gap-2 rounded-task border border-border bg-accent-50 px-6 py-10">
        <p className="text-answer font-semibold text-accent-900">Молодец, {firstName}!</p>
        <p className="text-answer text-accent-900">
          {correct} верно, {wrong} неверно
        </p>
      </div>
      <p className="text-text-secondary">Ошибки разберём вместе на уроке</p>
    </main>
  );
}
