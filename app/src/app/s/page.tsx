import { headers } from "next/headers";
import { formatDueDate, tasksLabel } from "@/domain/homework";
import { createServerCaller, isUnauthorized } from "@/server/router";
import { LinkExchange } from "@/components/link-exchange";

export const metadata = { title: "Домашка — StudySoft" };

export default async function StudentPage() {
  const caller = createServerCaller(await headers());
  let firstName: string;
  try {
    ({ firstName } = await caller.student.me());
  } catch (error) {
    if (isUnauthorized(error)) return <LinkExchange />;
    throw error;
  }
  const homework = await caller.student.homework.current();

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-task-title font-bold">Привет, {firstName}!</h1>
      {homework ? (
        <div className="rounded-task border border-border bg-accent-50 px-6 py-10 text-center">
          <p className="text-answer font-semibold text-accent-900">Домашка к {formatDueDate(homework.dueDate)}</p>
          <p className="mt-1 text-text-secondary">{tasksLabel(homework.taskCount)}</p>
        </div>
      ) : (
        <div className="rounded-task border border-border bg-accent-50 px-6 py-10 text-center">
          <p className="text-answer font-semibold text-accent-900">Домашних заданий пока нет</p>
        </div>
      )}
    </main>
  );
}
