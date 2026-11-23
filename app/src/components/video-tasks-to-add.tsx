"use client";

import { useState } from "react";
import type { Task } from "@/domain/homework-format";
import { routerClient } from "./router-client";

const control =
  "inline-flex h-9 items-center rounded-control border border-border px-3 text-small font-semibold hover:bg-surface disabled:opacity-60";

/**
 * «Добавить видео» in the draft editor (#330): a library video with confirmed
 * tasks; «Добавить в домашку» copies its tasks after the others, each
 * carrying the video, as the draft's own (product owner, 2026-11-23).
 */
export function VideoTasksToAdd({
  homeworkId,
  videos,
  disabled,
  onAdd,
}: {
  homeworkId: string;
  videos: { id: string; title: string }[];
  disabled: boolean;
  onAdd: (tasks: Task[]) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" className={`${control} self-start`} disabled={disabled} onClick={() => setOpen(true)}>
        Добавить видео
      </button>
    );
  }

  async function add() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const tasks = await routerClient.teacher.homework.videoTasks.query({ id: homeworkId, materialId: chosen });
      if (await onAdd(tasks)) {
        setOpen(false);
        setChosen("");
      }
    } catch {
      setError("Не получилось взять задания видео. Обновите страницу и попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Добавить видео" className="flex flex-col gap-3 rounded-card border border-border p-4">
      {videos.length === 0 ? (
        <p className="text-small text-text-secondary">В библиотеке нет видео с подтверждёнными заданиями</p>
      ) : (
        <label className="flex flex-col gap-1 text-small">
          <span className="text-text-secondary">Видео из библиотеки</span>
          <select value={chosen} onChange={(event) => setChosen(event.target.value)} className="h-10 rounded-control border border-border bg-bg px-3">
            <option value="">Выберите видео</option>
            {videos.map((video) => (
              <option key={video.id} value={video.id}>
                {video.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={control} disabled={disabled || busy || !chosen} onClick={() => void add()}>
          Добавить в домашку
        </button>
        <button type="button" className={control} onClick={() => setOpen(false)}>
          Отмена
        </button>
      </div>
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
