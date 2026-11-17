import Link from "next/link";
import { notFound } from "next/navigation";
import { formatPastDate, TASK_TYPE_LABELS } from "@/domain/homework";
import { isNotFound } from "@/server/router";
import { teacherCaller } from "../../../caller";

export const metadata = { title: "Прошлая сдача — StudySoft" };

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VERDICT = { true: "Верно", false: "Неверно", null: "Не проверено" } as const;

/**
 * A submission imported from the old tool (#38): the answers as the history
 * file gave them, for reading only — nothing to mark, comment or reopen.
 */
export default async function ImportedSubmissionPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { caller } = await teacherCaller();
  let submission;
  try {
    submission = await caller.teacher.history.get({ id });
  } catch (error) {
    if (isNotFound(error)) notFound();
    throw error;
  }

  return (
    <main className="flex max-w-3xl flex-col gap-6">
      <p>
        <Link
          href={`/teacher/students/${submission.studentId}`}
          className="text-small text-green-600 hover:text-green-700"
        >
          ← {submission.studentName}
        </Link>
      </p>
      <header className="flex flex-col gap-2">
        <h1 className="text-h1 font-bold">
          {submission.studentName} · {submission.title}
        </h1>
        <p className="text-text-secondary">
          Сдана {formatPastDate(submission.submittedOn)} · из прошлого инструмента
        </p>
        <p className="text-h3 font-semibold">
          {submission.correct} верно, {submission.wrong} неверно
        </p>
        {submission.unchecked > 0 && <p className="text-text-secondary">Без проверки: {submission.unchecked}</p>}
      </header>

      <ol className="flex flex-col gap-3">
        {submission.tasks.map((task) => (
          <li
            key={task.number}
            className={`rounded-card border p-4 ${task.correct === false ? "border-danger bg-danger-bg" : "border-border"}`}
          >
            <p className="text-caption text-text-muted">
              {task.number}. {TASK_TYPE_LABELS[task.type as keyof typeof TASK_TYPE_LABELS] ?? "Задание"}
              {task.topic && ` · ${task.topic}`}
            </p>
            <p className="mt-1 font-semibold">{task.question}</p>
            <p className={`mt-2 ${task.correct === false ? "text-danger" : ""}`}>
              {task.answer === null ? "Без ответа" : `Ответ: ${task.answer}`}
            </p>
            <p className="mt-1 text-small">{VERDICT[String(task.correct) as keyof typeof VERDICT]}</p>
            {task.correct === false && task.correctAnswer && (
              <p className="mt-1 text-small text-green-700">Правильный ответ: {task.correctAnswer}</p>
            )}
          </li>
        ))}
      </ol>
    </main>
  );
}
