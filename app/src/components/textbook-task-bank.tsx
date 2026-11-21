"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import type { StudentTask } from "@/domain/homework-format";
import { type BookSource, type SkippedExercise, sourceLabel } from "@/domain/task-bank";
import { Button } from "./button";
import { TaskAsStudent } from "./homework-runner";
import { routerClient } from "./router-client";

type BankTask = { task: StudentTask; source: BookSource | null };
type Tasks = { tasks: BankTask[]; skipped: SkippedExercise[] };
export type BankLesson = {
  lessonId: string;
  unit: string;
  title: string;
  confirmed: Tasks | null;
  draft: (Tasks & { revision: string }) | null;
};

/**
 * «Задания» on a textbook's page (#224): the task bank lesson by lesson. Each
 * task is shown as the child will see it, without the keys. The assistant's
 * draft lies beside the confirmed tasks: «Убрать» takes a task out of it and
 * «Подтвердить урок» makes it the lesson's tasks.
 */
export function TextbookTaskBank({ textbookId, lessons }: { textbookId: string; lessons: BankLesson[] }) {
  return (
    <section aria-label="Задания" className="flex flex-col gap-3 rounded-card border border-border p-4">
      <h2 className="text-h3 font-semibold">Задания</h2>
      {lessons.length === 0 ? (
        <p className="text-small text-text-secondary">Задания появятся по урокам, когда структура учебника будет подтверждена</p>
      ) : (
        lessons.map((lesson) => <LessonTasks key={lesson.lessonId} textbookId={textbookId} lesson={lesson} />)
      )}
    </section>
  );
}

function LessonTasks({ textbookId, lesson }: { textbookId: string; lesson: BankLesson }) {
  const router = useRouter();
  const heading = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirmed, draft } = lesson;

  async function run(change: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await change();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : "Не получилось сохранить. Попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  }

  const status = draft ? "Черновик от ассистента" : confirmed ? "Подтверждён" : "Заданий пока нет";
  return (
    <section aria-labelledby={heading} className="flex flex-col gap-3 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-3">
        <h3 id={heading} className="font-semibold">
          Урок {lesson.title}
        </h3>
        <span className="text-small text-text-secondary">{lesson.unit}</span>
        <span className="text-small text-text-secondary">{status}</span>
        {draft && confirmed && <span className="text-small text-text-secondary">Подтверждён</span>}
      </div>

      {confirmed && (
        <TaskList label="Подтверждённые задания" tasks={confirmed.tasks} skipped={draft ? [] : confirmed.skipped} />
      )}

      {draft && (
        <div className="flex flex-col gap-3 rounded-control bg-surface p-3">
          {confirmed && <p className="text-small text-text-secondary">Новый черновик заменит подтверждённые задания, когда вы подтвердите урок</p>}
          <TaskList
            label="Черновик от ассистента"
            tasks={draft.tasks}
            skipped={draft.skipped}
            remove={(index) =>
              run(() => routerClient.teacher.textbooks.removeBankTask.mutate({ textbookId, lessonId: lesson.lessonId, index, revision: draft.revision }))
            }
            busy={busy}
          />
          <div>
            <Button
              disabled={busy}
              onClick={() =>
                run(() => routerClient.teacher.textbooks.confirmBankLesson.mutate({ textbookId, lessonId: lesson.lessonId, revision: draft.revision }))
              }
            >
              Подтвердить урок
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

function TaskList({
  label,
  tasks,
  skipped,
  remove,
  busy = false,
}: {
  label: string;
  tasks: BankTask[];
  skipped: SkippedExercise[];
  remove?: (index: number) => void;
  busy?: boolean;
}) {
  return (
    <>
      {tasks.length === 0 ? (
        <p className="text-small text-text-secondary">{label}: заданий нет</p>
      ) : (
        <ol aria-label={label} className="flex flex-col gap-3">
          {tasks.map(({ task, source }, index) => (
            <li key={index} className="flex flex-col gap-2 rounded-control border border-border bg-bg p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-caption text-text-muted">
                  {index + 1}. {source ? sourceLabel(source) : "Своё задание"}
                </span>
                {remove && (
                  <Button variant="secondary" disabled={busy} onClick={() => remove(index)}>
                    Убрать
                  </Button>
                )}
              </div>
              <TaskAsStudent task={task} />
            </li>
          ))}
        </ol>
      )}
      {skipped.length > 0 && (
        <div className="flex flex-col gap-1 text-small">
          <p className="font-semibold">Не превращены:</p>
          <ul className="flex flex-col gap-1">
            {skipped.map((item, i) => (
              <li key={i}>
                {sourceLabel(item.source)} — {item.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
