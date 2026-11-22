"use client";

import { useState } from "react";
import type { Answer, StudentTask } from "@/domain/homework-format";
import { TaskToAnswer } from "./homework-runner";
import { routerClient } from "./router-client";

const PRAISE = "Готово! Ответы отправлены, учитель посмотрит";

/**
 * «Задания к видео» under a video behind the student's link (#327): the
 * confirmed tasks, one attempt, «Готово», then praise only — no score,
 * nothing right or wrong, as in homework (#227). Answered once in this
 * lesson, the tasks give way to the praise.
 */
export function StudentVideoTasks({ id, tasks, done }: { id: string; tasks: StudentTask[]; done: boolean }) {
  const [answers, setAnswers] = useState<(Answer | null)[]>(() => tasks.map(() => null));
  const [sent, setSent] = useState(done);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await routerClient.student.videos.submitTasks.mutate({ id, answers });
      setSent(true);
    } catch (cause) {
      const code = (cause as { data?: { code?: string } } | null)?.data?.code;
      // Answered already, from another device: the praise is what is current.
      if (code === "CONFLICT") setSent(true);
      else setError("Не получилось отправить. Проверьте интернет и нажмите «Готово» ещё раз");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Задания к видео" className="flex flex-col gap-4 rounded-task border border-border p-4">
      <h2 className="text-answer font-bold">Задания к видео</h2>
      {sent ? (
        <p className="rounded-task bg-accent-50 px-4 py-6 text-center text-answer font-semibold text-accent-900">{PRAISE}</p>
      ) : (
        <>
          <ol className="flex flex-col gap-4">
            {tasks.map((task, index) => (
              <li key={index} className="rounded-task border border-border p-3">
                <TaskToAnswer
                  task={task}
                  answer={answers[index] ?? null}
                  onChange={(next) => setAnswers((current) => current.map((a, i) => (i === index ? next : a)))}
                />
              </li>
            ))}
          </ol>
          {error && (
            <p role="alert" className="rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="h-12 rounded-task bg-accent-600 px-6 text-answer font-semibold text-on-accent disabled:opacity-60"
          >
            Готово
          </button>
        </>
      )}
    </section>
  );
}
