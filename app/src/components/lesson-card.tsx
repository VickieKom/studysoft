"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { dateIn, dayMonthIn, LESSON_STATUS_LABELS, timeIn } from "@/domain/schedule";
import { Button } from "./button";
import { useOverlapWarning } from "./overlap-warning";
import { routerClient } from "./router-client";

type Lesson = {
  id: string;
  studentId: string;
  studentName: string;
  studentTimeZone: string;
  startsAt: string;
  durationMinutes: number;
  kind: "regular" | "intro";
  status: "scheduled" | "held" | "missed" | "cancelled";
  charged: boolean | null;
  unit: string | null;
  note: string | null;
  needsMark: boolean;
  movedFrom: string | null;
  meetingLink: string | null;
};

const field = "rounded-control border border-border bg-bg px-3 py-2";

/**
 * A lesson on the week (#80). It opens a dialog where a lesson that has
 * started is marked «Проведён» or «Пропущен», with «Списать», the unit and a
 * note (#82); a marked lesson opens with its values and can be changed. A
 * lesson not marked yet can be moved or cancelled, and every lesson has its
 * own meeting link (#81).
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
  const [status, setStatus] = useState<"held" | "missed" | null>(
    lesson.status === "held" || lesson.status === "missed" ? lesson.status : null,
  );
  // A held lesson is charged by default; a missed one is not, for now
  // (product owner, 2026-11-13). The teacher can change it on every lesson.
  const [charged, setCharged] = useState(lesson.charged ?? lesson.status === "held");
  const [chargeTouched, setChargeTouched] = useState(false);
  const [unit, setUnit] = useState(lesson.unit ?? "");
  const [note, setNote] = useState(lesson.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const free = lesson.kind === "intro";
  const [mode, setMode] = useState<"none" | "move" | "cancel">("none");
  const [moveDate, setMoveDate] = useState(dateIn(moment, lesson.studentTimeZone));
  const [moveTime, setMoveTime] = useState(timeIn(moment, lesson.studentTimeZone));
  const [overlap, checkOverlap] = useOverlapWarning();
  // A cancellation is not charged by default, late or not, for now (product
  // owner, 2026-11-13); a cancelled lesson opens with the saved choice.
  const [cancelCharged, setCancelCharged] = useState(lesson.status === "cancelled" && lesson.charged === true);
  const [link, setLink] = useState(lesson.meetingLink ?? "");
  const [linkState, setLinkState] = useState<"saved" | "copied" | null>(null);

  async function save(action: () => Promise<unknown>, failure: string) {
    setError(null);
    try {
      await action();
      dialog.current?.close();
      setMode("none");
      router.refresh();
    } catch {
      setError(failure);
    }
  }

  function chooseMove(date: string, time: string) {
    setMoveDate(date);
    setMoveTime(time);
    checkOverlap({
      studentId: lesson.studentId,
      date,
      time,
      durationMinutes: lesson.durationMinutes,
      exceptLessonId: lesson.id,
    });
  }

  async function onMove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await save(
      () => routerClient.teacher.schedule.move.mutate({ lessonId: lesson.id, date: moveDate, time: moveTime }),
      "Не получилось перенести урок",
    );
  }

  async function onCancel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await save(
      () => routerClient.teacher.schedule.cancel.mutate({ lessonId: lesson.id, charged: !free && cancelCharged }),
      "Не получилось отменить урок",
    );
  }

  async function saveLink() {
    setError(null);
    setLinkState(null);
    try {
      await routerClient.teacher.schedule.setMeetingLink.mutate({ lessonId: lesson.id, link });
      setLinkState("saved");
      router.refresh();
    } catch {
      setError("Не получилось сохранить ссылку: нужна ссылка вида https://…");
    }
  }

  async function copyLink() {
    setError(null);
    try {
      await navigator.clipboard.writeText(link.trim());
      setLinkState("copied");
    } catch {
      setError("Не удалось скопировать");
    }
  }

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
  const cancelled = lesson.status === "cancelled";
  const changeable = lesson.status === "scheduled";
  const errorLine = error && (
    <p role="alert" className="text-small text-danger">
      {error}
    </p>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className={`flex flex-col items-start rounded-control px-2 py-1 text-left text-small ${
          cancelled
            ? "bg-surface text-text-muted"
            : free
              ? "border border-dashed border-green-600 bg-green-50"
              : lesson.needsMark
                ? "bg-danger-bg"
                : "bg-accent-50"
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
        {lesson.movedFrom && (
          <span className="text-text-secondary">перенесён с {dayMonthIn(new Date(lesson.movedFrom), timeZone)}</span>
        )}
        {lesson.needsMark && <span className="text-danger">отметьте урок</span>}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={`lesson-${lesson.id}-heading`}
        onClose={() => setMode("none")}
        className="m-auto w-full max-w-md rounded-card border border-border p-6 backdrop:bg-black/30"
      >
        <h2 id={`lesson-${lesson.id}-heading`} className="mb-4 text-h3 font-semibold">
          {lesson.studentName}, {timeIn(moment, timeZone)}
        </h2>
        <div className="flex flex-col gap-4">
          {cancelled && (
            <form onSubmit={onCancel} className="flex flex-col gap-3">
              <p className="text-text-secondary">Урок отменён.</p>
              {!free && (
                <div className="flex items-center gap-2">
                  <input
                    id={`cancel-charge-${lesson.id}`}
                    type="checkbox"
                    checked={cancelCharged}
                    onChange={(e) => setCancelCharged(e.target.checked)}
                  />
                  <label htmlFor={`cancel-charge-${lesson.id}`}>Списать</label>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {!free && <Button type="submit">Сохранить</Button>}
                <Button
                  variant="secondary"
                  onClick={() =>
                    save(
                      () => routerClient.teacher.schedule.restore.mutate({ lessonId: lesson.id }),
                      "Не получилось вернуть урок",
                    )
                  }
                >
                  Вернуть в расписание
                </Button>
              </div>
            </form>
          )}
          {changeable && mode === "none" && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setMode("move")}>
                Перенести
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  // Unticked on every entry: a charged cancellation that was restored must not leave it ticked.
                  setCancelCharged(false);
                  setMode("cancel");
                }}
              >
                Отменить
              </Button>
            </div>
          )}
          {mode === "move" && (
            <form onSubmit={onMove} className="flex flex-col gap-3">
              <p className="text-small text-text-secondary">Дата и время — по часовому поясу ученика.</p>
              <label htmlFor={`move-date-${lesson.id}`} className="text-small text-text-secondary">
                Дата
              </label>
              <input
                id={`move-date-${lesson.id}`}
                type="date"
                required
                value={moveDate}
                onChange={(e) => chooseMove(e.target.value, moveTime)}
                className={field}
              />
              <label htmlFor={`move-time-${lesson.id}`} className="text-small text-text-secondary">
                Время
              </label>
              <input
                id={`move-time-${lesson.id}`}
                type="time"
                required
                value={moveTime}
                onChange={(e) => chooseMove(moveDate, e.target.value)}
                className={field}
              />
              {overlap && <p className="text-small text-danger">{overlap}</p>}
              <div className="flex gap-2">
                <Button type="submit">Сохранить</Button>
                <Button variant="secondary" onClick={() => setMode("none")}>
                  Назад
                </Button>
              </div>
            </form>
          )}
          {mode === "cancel" && (
            <form onSubmit={onCancel} className="flex flex-col gap-3">
              {!free && (
                <div className="flex items-center gap-2">
                  <input
                    id={`cancel-charge-${lesson.id}`}
                    type="checkbox"
                    checked={cancelCharged}
                    onChange={(e) => setCancelCharged(e.target.checked)}
                  />
                  <label htmlFor={`cancel-charge-${lesson.id}`}>Списать</label>
                </div>
              )}
              <div className="flex gap-2">
                <Button type="submit">Отменить урок</Button>
                <Button variant="secondary" onClick={() => setMode("none")}>
                  Назад
                </Button>
              </div>
            </form>
          )}
          {mode === "none" &&
            !cancelled &&
            (started ? (
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
                        onChange={() => {
                          setStatus(value);
                          if (!chargeTouched) setCharged(value === "held");
                        }}
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
                      onChange={(e) => {
                        setCharged(e.target.checked);
                        setChargeTouched(true);
                      }}
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
                <Button type="submit" className="self-start">
                  Сохранить отметку
                </Button>
              </form>
            ) : (
              <p className="text-small text-text-secondary">Отметить урок можно после его начала.</p>
            ))}
          {mode === "none" && (
            <div className="flex flex-col gap-2 border-t border-border pt-3">
              <label htmlFor={`link-${lesson.id}`} className="text-small text-text-secondary">
                Ссылка на встречу
              </label>
              <input
                id={`link-${lesson.id}`}
                type="url"
                value={link}
                onChange={(e) => {
                  setLink(e.target.value);
                  setLinkState(null);
                }}
                className={field}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={saveLink}>
                  Сохранить ссылку
                </Button>
                <Button variant="secondary" onClick={copyLink} disabled={link.trim() === ""}>
                  Скопировать
                </Button>
                <span role="status" className="text-small text-text-secondary">
                  {linkState === "saved" && "Ссылка сохранена"}
                  {linkState === "copied" && "Ссылка скопирована"}
                </span>
              </div>
            </div>
          )}
          {errorLine}
          <Button
            variant="secondary"
            className="self-start"
            onClick={() => {
              dialog.current?.close();
              setMode("none");
            }}
          >
            Закрыть
          </Button>
        </div>
      </dialog>
    </>
  );
}
