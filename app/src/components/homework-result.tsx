import type { ReactNode } from "react";

/**
 * The screen after «Сдать» (#34): praise, and no score (#227, product owner
 * 2026-11-20): the automatic check does not decide for the teacher, so the
 * child sees neither how many nor which tasks were right. The teacher has the
 * score in «Проверка домашек»; mistakes are reviewed in the lesson (#153).
 * The mini-question, when the teacher ticked it (#331), comes under the praise.
 */
export function HomeworkResult({ firstName, children }: { firstName: string; children?: ReactNode }) {
  return (
    <main className="flex flex-col gap-6 text-center">
      <div className="flex flex-col gap-2 rounded-task border border-border bg-accent-50 px-6 py-10">
        <h1 className="text-task-title font-bold text-accent-900">Готово! Домашка сдана, учитель посмотрит</h1>
        <p className="text-answer font-semibold text-accent-900">Молодец, {firstName}!</p>
      </div>
      {children}
      <p className="text-text-secondary">Ошибки разберём вместе на уроке</p>
    </main>
  );
}
