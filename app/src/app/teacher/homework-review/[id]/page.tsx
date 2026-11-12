import Link from "next/link";
import { notFound } from "next/navigation";
import { ReviewComment, ReviewMark, ReviewReopen } from "@/components/review-controls";
import { formatReviewDate, TASK_TYPE_LABELS } from "@/domain/homework";
import { isNotFound } from "@/server/router";
import { teacherCaller } from "../../caller";

export const metadata = { title: "Сдача — StudySoft" };

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One submission (#36): every answer, the correct one next to each mistake,
 * mistakes by topic, the teacher's marks and comment, and the attempts.
 */
export default async function SubmissionPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { caller } = await teacherCaller();
  let submission;
  try {
    submission = await caller.teacher.review.get({ id });
  } catch (error) {
    if (isNotFound(error)) notFound();
    throw error;
  }
  if (submission.isCurrent) await caller.teacher.review.opened({ id });

  return (
    <main className="flex max-w-3xl flex-col gap-6">
      <p>
        <Link href="/teacher/homework-review" className="text-small text-green-600 hover:text-green-700">
          ← Проверка домашек
        </Link>
      </p>
      <header className="flex flex-col gap-2">
        <h1 className="text-h1 font-bold">
          {submission.studentName} · {submission.title}
        </h1>
        <p className="text-text-secondary">
          Сдана {formatReviewDate(submission.submittedAt)}
          {submission.attempts.length > 1 && `, попытка ${submission.attempt}`}
        </p>
        <p className="text-h3 font-semibold">
          {submission.correct} верно, {submission.wrong} неверно
        </p>
        {submission.pending > 0 && <p className="text-text-secondary">Ждёт проверки: {submission.pending}</p>}
      </header>

      <ol className="flex flex-col gap-3">
        {submission.tasks.map((task) => (
          <li
            key={task.index}
            className={`rounded-card border p-4 ${task.verdict === false ? "border-danger bg-danger-bg" : "border-border"}`}
          >
            <p className="text-caption text-text-muted">
              {task.index + 1}. {TASK_TYPE_LABELS[task.type as keyof typeof TASK_TYPE_LABELS]}
              {task.topic && ` · ${task.topic}`}
            </p>
            <p className="mt-1 font-semibold">{task.prompt}</p>
            <p className={`mt-2 ${task.verdict === false ? "text-danger" : ""}`}>
              {task.answer === null ? "Без ответа" : `Ответ: ${task.answer}`}
            </p>
            {task.verdict === false && task.key && (
              <p className="mt-1 text-small text-green-700">Правильный ответ: {task.key}</p>
            )}
            {submission.isCurrent && (
              <ReviewMark submissionId={submission.id} taskIndex={task.index} verdict={task.verdict} />
            )}
          </li>
        ))}
      </ol>

      <section aria-label="Ошибки по темам" className="rounded-card border border-border p-4">
        <h2 className="text-h3 font-semibold">Ошибки по темам</h2>
        {submission.mistakesByTopic.length === 0 ? (
          <p className="mt-2 text-text-secondary">Ошибок нет</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {submission.mistakesByTopic.map((m) => (
              <li key={m.topic}>
                {m.topic}: {m.count}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ReviewComment submissionId={submission.id} comment={submission.comment} />

      {submission.canReopen && <ReviewReopen submissionId={submission.id} />}
      {!submission.isCurrent && (
        <p role="status" className="text-text-secondary">
          Открыта заново для ученика: эта попытка осталась в истории как была
        </p>
      )}

      {submission.attempts.length > 1 && (
        <section aria-label="Попытки" className="rounded-card border border-border p-4">
          <h2 className="text-h3 font-semibold">Попытки</h2>
          <ul className="mt-2 flex flex-col gap-1">
            {submission.attempts.map((a) => (
              <li key={a.id}>
                <Link href={`/teacher/homework-review/${a.id}`} className="hover:underline">
                  Попытка {a.attempt}, {formatReviewDate(a.submittedAt)}: {a.correct} верно, {a.wrong} неверно
                  {a.isCurrent && " · текущая"}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
