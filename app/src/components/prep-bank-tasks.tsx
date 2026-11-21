"use client";

import Link from "next/link";
import { useId, useState } from "react";
import type { StudentTask } from "@/domain/homework-format";
import { type BookSource, sourceLabel } from "@/domain/task-bank";
import { Button } from "./button";
import { TaskAsStudent } from "./homework-runner";
import { routerClient } from "./router-client";

export type PrepBankLesson = {
  bookLessonId: string;
  title: string;
  textbookId: string;
  confirmed: { tasks: { task: StudentTask; source: BookSource | null }[]; revision: string } | null;
};

/**
 * A book lesson's confirmed bank tasks in «Домашка к уроку» (#226), as the
 * child will see them, each with «В домашку». «Собрать домашку» appends the
 * checked ones to the draft chosen for the lesson, or makes a new one, and
 * attaches it; then the draft editor as always, for her own tasks.
 */
export function PrepBankTasks({
  lessonId,
  lesson,
  homeworkId,
  onBuilt,
}: {
  lessonId: string;
  lesson: PrepBankLesson;
  homeworkId: string | null;
  onBuilt: (homeworkId: string) => void;
}) {
  const id = useId();
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirmed } = lesson;
  const label = `Задания урока ${lesson.title}`;

  if (!confirmed) {
    return (
      <p className="text-small text-text-secondary">
        У урока {lesson.title} нет подтверждённых заданий в банке:{" "}
        <Link href={`/teacher/library/textbooks/${lesson.textbookId}`} className="text-green-600 hover:text-green-700">
          подтвердите их на странице учебника
        </Link>
      </p>
    );
  }

  async function build() {
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const built = await routerClient.teacher.prep.buildHomework.mutate({
        lessonId,
        bookLessonId: lesson.bookLessonId,
        picks: picked,
        revision: confirmed.revision,
        homeworkId,
      });
      setPicked([]);
      onBuilt(built.homeworkId);
    } catch (cause) {
      const code = (cause as { data?: { code?: string } } | null)?.data?.code;
      setError((code === "BAD_REQUEST" || code === "CONFLICT") && cause instanceof Error ? cause.message : "Не получилось собрать. Попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-semibold">{label}</h3>
      {confirmed.tasks.length === 0 ? (
        <p className="text-small text-text-secondary">В банке у урока заданий нет</p>
      ) : (
        <ol aria-label={label} className="flex flex-col gap-3">
          {confirmed.tasks.map(({ task, source }, index) => (
            <li key={index} className="flex flex-col gap-2 rounded-control border border-border bg-bg p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-caption text-text-muted">
                  {index + 1}. {source ? sourceLabel(source) : "Своё задание"}
                </span>
                <label htmlFor={`${id}-${index}`} className="flex items-center gap-2 text-small">
                  <input
                    id={`${id}-${index}`}
                    type="checkbox"
                    checked={picked.includes(index)}
                    onChange={(event) => setPicked(event.target.checked ? [...picked, index] : picked.filter((i) => i !== index))}
                  />
                  В домашку
                </label>
              </div>
              <TaskAsStudent task={task} />
            </li>
          ))}
        </ol>
      )}
      {error && (
        <p role="alert" className="whitespace-pre-line rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}
      <div>
        <Button variant="secondary" disabled={busy || picked.length === 0} onClick={build}>
          Собрать домашку
        </Button>
      </div>
    </div>
  );
}
