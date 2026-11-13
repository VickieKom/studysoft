"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { LESSON_STATUS_LABELS, timeIn } from "@/domain/schedule";
import { Button } from "./button";
import { routerClient } from "./router-client";

type Lesson = {
  id: string;
  studentName: string;
  studentTimeZone: string;
  startsAt: string;
  durationMinutes: number;
  kind: "regular" | "intro";
  status: "scheduled" | "held" | "missed";
  charged: boolean | null;
  unit: string | null;
  note: string | null;
  needsMark: boolean;
};

const field = "rounded-control border border-border bg-bg px-3 py-2";

/**
 * A lesson on the week (#80). It opens a dialog where a lesson that has
 * started is marked «Проведён» or «Пропущен», with «Списать», the unit and a
 * note (#82); a marked lesson opens with its values and can be changed.
 */
export function LessonCard({
  lesson,
  started,
  timeZone,
  zoneLabels,
}: {
  lesson: Lesson;
  /** Whether the lesson has started, as the server saw it: only then it can be marked. */
  started: boolean;
  timeZone: string;
  zoneLabels: Record<string, string>;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const moment = new Date(lesson.startsAt);
  const [status, setStatus] = useState<"held" | "missed" | null>(lesson.status === "scheduled" ? null : lesson.status);
  const [charged, setCharged] = useState(lesson.charged ?? true);
  const [unit, setUnit] = useState(lesson.unit ?? "");
  const [note, setNote] = useState(lesson.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const free = lesson.kind === "intro";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!status) return setError("Отметьте, проведён урок или пропущен");
    setError(null);
    try {
      await routerClient.teacher.schedule.mark.mutate({ lessonId: lesson.id, status, charged: !free && charged, unit, note });
      dialog.current?.close();
      router.refresh();
    } catch {
      setError("Не получилось сохранить отметку");
    }
  }

  const sameZone = lesson.studentTimeZone === timeZone;
  const mark = LESSON_STATUS_LABELS[lesson.status];

  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className={`flex flex-col items-start rounded-control px-2 py-1 text-left text-small ${
          free ? "border border-dashed border-green-600 bg-green-50" : lesson.needsMark ? "bg-danger-bg" : "bg-accent-50"
        }`}
      >
        <span className="font-semibold">
          {timeIn(moment, timeZone)} {lesson.studentName}
        </span>
        {!sameZone && (
          <span className="text-text-secondary">
            у ученика {timeIn(moment, lesson.studentTimeZone)} ({zoneLabels[lesson.studentTimeZone] ?? lesson.studentTimeZone})
          </span>
        )}
        <span className="text-text-muted">
          {lesson.durationMinutes} мин{free && " · вводный"}
          {mark && ` · ${mark}`}
        </span>
        {lesson.needsMark && <span className="text-danger">отметьте урок</span>}
      </button>
      <dialog ref={dialog} className="m-auto w-full max-w-md rounded-card border border-border p-6 backdrop:bg-black/30">
        <h2 className="mb-4 text-h3 font-semibold">
          {lesson.studentName}, {timeIn(moment, timeZone)}
        </h2>
        {started ? (
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <fieldset className="flex gap-4">
              <legend className="mb-1 text-small text-text-secondary">Урок</legend>
              {(["held", "missed"] as const).map((value) => (
                <div key={value} className="flex items-center gap-2">
                  <input
                    id={`mark-${lesson.id}-${value}`}
                    type="radio"
                    name={`mark-${lesson.id}`}
                    checked={status === value}
                    onChange={() => setStatus(value)}
                  />
                  <label htmlFor={`mark-${lesson.id}-${value}`}>{value === "held" ? "Проведён" : "Пропущен"}</label>
                </div>
              ))}
            </fieldset>
            {!free && (
              <div className="flex items-center gap-2">
                <input
                  id={`charge-${lesson.id}`}
                  type="checkbox"
                  checked={charged}
                  onChange={(e) => setCharged(e.target.checked)}
                />
                <label htmlFor={`charge-${lesson.id}`}>Списать</label>
              </div>
            )}
            <label htmlFor={`unit-${lesson.id}`} className="text-small text-text-secondary">
              Юнит
            </label>
            <input id={`unit-${lesson.id}`} value={unit} onChange={(e) => setUnit(e.target.value)} className={field} />
            <label htmlFor={`note-${lesson.id}`} className="text-small text-text-secondary">
              Заметка
            </label>
            <textarea
              id={`note-${lesson.id}`}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={field}
            />
            {error && (
              <p role="alert" className="text-small text-danger">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button type="submit">Сохранить отметку</Button>
              <Button variant="secondary" onClick={() => dialog.current?.close()}>
                Закрыть
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-text-secondary">Урок ещё не начался: отметить его можно после начала.</p>
            <Button variant="secondary" className="self-start" onClick={() => dialog.current?.close()}>
              Закрыть
            </Button>
          </div>
        )}
      </dialog>
    </>
  );
}
