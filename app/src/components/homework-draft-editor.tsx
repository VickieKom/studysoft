"use client";

import { useState } from "react";
import { homeworkImageUrl, TASK_TYPE_LABELS } from "@/domain/homework";
import { TASK_TYPES, type Task, type TaskType } from "@/domain/homework-format";
import { HomeworkTaskForm } from "./homework-task-form";
import { HomeworkTaskPreview } from "./homework-task-preview";
import { routerClient } from "./router-client";

const control =
  "inline-flex h-9 items-center rounded-control border border-border px-3 text-small font-semibold hover:bg-surface disabled:opacity-60";

/**
 * The draft editor (#37): change, add, delete and reorder tasks in place. Every
 * change sends the whole list; the server validates it against the homework
 * format and keeps the draft as it was when something is invalid. Nothing asks
 * for confirmation, like the rest of the workspace.
 */
export function HomeworkDraftEditor({ homeworkId, tasks: initial }: { homeworkId: string; tasks: Task[] }) {
  const [tasks, setTasks] = useState(initial);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [newType, setNewType] = useState<TaskType>("single_choice");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Saves the list; true when the server took it. */
  async function save(next: Task[]): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const saved = await routerClient.teacher.homework.updateTasks.mutate({ id: homeworkId, tasks: next });
      setTasks(saved.tasks);
      return true;
    } catch (cause) {
      const code = (cause as { data?: { code?: string } } | null)?.data?.code;
      // The server's own messages are in Russian only for an invalid homework.
      if (code === "BAD_REQUEST" && cause instanceof Error) setError(cause.message);
      else if (code === "NOT_FOUND") setError("Домашка уже опубликована в другой вкладке. Обновите страницу");
      else setError("Не получилось сохранить. Попробуйте ещё раз");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function saveTask(task: Task) {
    const next = editing === "new" ? [...tasks, task] : tasks.map((t, i) => (i === editing ? task : t));
    if (await save(next)) setEditing(null);
  }

  function move(from: number, to: number) {
    const next = [...tasks];
    const [task] = next.splice(from, 1);
    next.splice(to, 0, task!);
    void save(next);
  }

  function openForm(target: number | "new" | null) {
    setError(null);
    setEditing(target);
  }

  const form = (task: Task | null) => (
    <HomeworkTaskForm
      key={String(editing)}
      imageUrl={task?.image && typeof editing === "number" ? homeworkImageUrl(homeworkId, editing) : null}
      type={task?.type ?? newType}
      task={task}
      pending={pending}
      error={error}
      onSave={saveTask}
      onCancel={() => openForm(null)}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-4">
        {tasks.map((task, index) => (
          <li key={index} className="rounded-card border border-border p-4">
            {editing === index ? (
              form(task)
            ) : (
              <>
                <HomeworkTaskPreview task={task} number={index + 1} homeworkId={homeworkId} />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className={control} disabled={pending} onClick={() => openForm(index)}>
                    Изменить задание
                  </button>
                  {index > 0 && (
                    <button type="button" className={control} disabled={pending} onClick={() => move(index, index - 1)}>
                      Выше
                    </button>
                  )}
                  {index < tasks.length - 1 && (
                    <button type="button" className={control} disabled={pending} onClick={() => move(index, index + 1)}>
                      Ниже
                    </button>
                  )}
                  {tasks.length > 1 && (
                    <button
                      type="button"
                      className={control}
                      disabled={pending}
                      onClick={() => void save(tasks.filter((_, i) => i !== index))}
                    >
                      Удалить задание
                    </button>
                  )}
                </div>
              </>
            )}
          </li>
        ))}
      </ol>

      {editing === "new" ? (
        <section aria-label="Новое задание" className="rounded-card border border-border p-4">
          {form(null)}
        </section>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="new-task-type" className="text-small text-text-secondary">
              Тип нового задания
            </label>
            <select
              id="new-task-type"
              value={newType}
              onChange={(event) => setNewType(event.target.value as TaskType)}
              className="h-10 rounded-control border border-border bg-bg px-3"
            >
              {TASK_TYPES.map((type) => (
                <option key={type} value={type}>
                  {TASK_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className={control} disabled={pending || tasks.length >= 50} onClick={() => openForm("new")}>
            Добавить задание
          </button>
        </div>
      )}

      {error && editing === null && (
        <p role="alert" className="whitespace-pre-line rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
