/**
 * The screen after «Сдать» (#34): praise, and no score (#227, product owner
 * 2026-11-20): the automatic check does not decide for the teacher, so the
 * child sees neither how many nor which tasks were right. The teacher has the
 * score in «Проверка домашек»; mistakes are reviewed in the lesson (#153).
 */
export function HomeworkResult({ firstName }: { firstName: string }) {
  return (
    <main className="flex flex-col gap-6 text-center">
      <div className="flex flex-col gap-2 rounded-task border border-border bg-accent-50 px-6 py-10">
        <h1 className="text-task-title font-bold text-accent-900">Готово! Домашка сдана, учитель посмотрит</h1>
        <p className="text-answer font-semibold text-accent-900">Молодец, {firstName}!</p>
      </div>
      <p className="text-text-secondary">Ошибки разберём вместе на уроке</p>
    </main>
  );
}
