"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { StudentTask } from "@/domain/homework-format";
import { Button } from "./button";
import { TaskAsStudent } from "./homework-runner";
import { routerClient } from "./router-client";

export type VideoTasksData = { confirmed: StudentTask[] | null; draft: { tasks: StudentTask[]; revision: string } | null };

/**
 * «Задания к видео» on a library video's page (#326). Each task is shown as
 * the child will see it, without the keys. The assistant's draft lies beside
 * the confirmed tasks: «Убрать» takes a task out of it and «Подтвердить»
 * makes it the video's tasks, the ones a student gets. Both send the
 * revision the page loaded, so a draft the assistant replaced meanwhile is
 * never changed or confirmed unseen.
 */
export function VideoTasks({ id, tasks }: { id: string; tasks: VideoTasksData }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirmed, draft } = tasks;

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

  return (
    <section aria-label="Задания к видео" className="flex flex-col gap-3 rounded-card border border-border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-h3 font-semibold">Задания к видео</h2>
        {confirmed && <span className="text-small text-text-secondary">Подтверждено</span>}
      </div>
      {!confirmed && !draft && <p className="text-small text-text-secondary">Заданий пока нет: их составит ассистент по расшифровке видео</p>}

      {confirmed && <TaskList label="Подтверждённые задания" tasks={confirmed} />}

      {draft && (
        <section aria-label="Черновик от ассистента" className="flex flex-col gap-3 rounded-control bg-surface p-3">
          <p className="text-small font-semibold text-text-secondary">Черновик от ассистента</p>
          {confirmed && <p className="text-small text-text-secondary">Новый черновик заменит подтверждённые задания, когда вы его подтвердите</p>}
          <TaskList
            label="Задания черновика"
            tasks={draft.tasks}
            remove={(index) => run(() => routerClient.teacher.library.removeVideoTask.mutate({ id, index, revision: draft.revision }))}
            busy={busy}
          />
          <div>
            <Button disabled={busy} onClick={() => run(() => routerClient.teacher.library.confirmVideoTasks.mutate({ id, revision: draft.revision }))}>
              Подтвердить
            </Button>
          </div>
        </section>
      )}

      {error && (
        <p role="alert" className="rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

function TaskList({ label, tasks, remove, busy = false }: { label: string; tasks: StudentTask[]; remove?: (index: number) => void; busy?: boolean }) {
  return (
    <section aria-label={label}>
      <ol className="flex flex-col gap-3">
        {tasks.map((task, index) => (
          <li key={index} className="flex flex-col gap-2 rounded-control border border-border bg-bg p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-caption text-text-muted">Задание {index + 1}</span>
              {remove && tasks.length > 1 && (
                <Button variant="secondary" disabled={busy} onClick={() => remove(index)}>
                  Убрать
                </Button>
              )}
            </div>
            <TaskAsStudent task={task} />
          </li>
        ))}
      </ol>
    </section>
  );
}
