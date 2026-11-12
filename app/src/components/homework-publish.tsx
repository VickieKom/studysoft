"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { formatDueDate } from "@/domain/homework";
import { Button } from "./button";
import { routerClient } from "./router-client";

type Props = { homeworkId: string; status: "draft" | "published" | "submitted" | "missed"; dueDate: string | null };

/** Publish a draft with a deadline, or take a published homework back (#32). */
export function HomeworkPublish({ homeworkId, status, dueDate }: Props) {
  const router = useRouter();
  const [date, setDate] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await action();
      router.refresh();
    } catch {
      setError("Не получилось. Обновите страницу и попробуйте ещё раз");
    } finally {
      setPending(false);
    }
  }

  async function onPublish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!date) return;
    await run(() => routerClient.teacher.homework.publish.mutate({ id: homeworkId, dueDate: date }));
  }

  if (status === "missed" || status === "submitted") return null;

  return (
    <div className="flex flex-col gap-2">
      {status === "draft" ? (
        <form onSubmit={onPublish} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="homework-due" className="text-small text-text-secondary">
              Срок
            </label>
            <input
              id="homework-due"
              type="date"
              required
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="h-10 rounded-control border border-border px-3"
            />
          </div>
          <Button type="submit" disabled={pending || !date}>
            Опубликовать
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {dueDate && <span>Срок: {formatDueDate(dueDate)}</span>}
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => run(() => routerClient.teacher.homework.unpublish.mutate({ id: homeworkId }))}
          >
            Снять с публикации
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
