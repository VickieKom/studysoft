"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useState } from "react";
import { DEFAULT_DURATION, DURATIONS, dayMonthIn, WEEKDAYS, weekdayLabel } from "@/domain/schedule";
import { Button } from "./button";
import { useOverlapWarning } from "./overlap-warning";
import { routerClient } from "./router-client";

const field = "h-10 rounded-control border border-border bg-bg px-3";

function Labelled({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-small text-text-secondary">
        {label}
      </label>
      {children}
    </div>
  );
}

function DurationSelect({ id, value, onChange }: { id: string; value: number; onChange: (value: number) => void }) {
  return (
    <select id={id} value={value} onChange={(event) => onChange(Number(event.target.value))} className={field}>
      {DURATIONS.map((d) => (
        <option key={d} value={d}>
          {d} мин
        </option>
      ))}
    </select>
  );
}

/** «+ Урок»: a one-off lesson at the student's local date and time, maybe an introductory one. */
export function AddLessonForm({ students }: { students: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [studentId, setStudentId] = useState(students[0]?.id ?? "");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState<number>(DEFAULT_DURATION);
  const [intro, setIntro] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overlap, checkOverlap] = useOverlapWarning();
  const choose = (at: Partial<{ studentId: string; date: string; time: string; duration: number }>) => {
    const next = { studentId, date, time, duration, ...at };
    checkOverlap({ studentId: next.studentId, date: next.date, time: next.time, durationMinutes: next.duration });
  };

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await routerClient.teacher.schedule.addLesson.mutate({
        studentId,
        date,
        time,
        durationMinutes: duration as 45 | 60 | 90,
        intro,
      });
      setOpen(false);
      router.refresh();
    } catch {
      setError("Не получилось сохранить урок");
    }
  }

  if (!open) {
    return (
      <Button variant="secondary" className="self-start" onClick={() => setOpen(true)}>
        + Урок
      </Button>
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3 rounded-card border border-border p-4">
      <Labelled id="lesson-student" label="Ученик">
        <select
          id="lesson-student"
          value={studentId}
          onChange={(e) => {
            setStudentId(e.target.value);
            choose({ studentId: e.target.value });
          }}
          className={field}
        >
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Labelled>
      <Labelled id="lesson-date" label="Дата">
        <input
          id="lesson-date"
          type="date"
          required
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            choose({ date: e.target.value });
          }}
          className={field}
        />
      </Labelled>
      <Labelled id="lesson-time" label="Время">
        <input
          id="lesson-time"
          type="time"
          required
          value={time}
          onChange={(e) => {
            setTime(e.target.value);
            choose({ time: e.target.value });
          }}
          className={field}
        />
      </Labelled>
      <Labelled id="lesson-duration" label="Длительность">
        <DurationSelect
          id="lesson-duration"
          value={duration}
          onChange={(value) => {
            setDuration(value);
            choose({ duration: value });
          }}
        />
      </Labelled>
      <div className="flex h-10 items-center gap-2">
        <input id="lesson-intro" type="checkbox" checked={intro} onChange={(e) => setIntro(e.target.checked)} />
        <label htmlFor="lesson-intro">Вводный урок</label>
      </div>
      <p className="w-full text-small text-text-secondary">Дата и время — по часовому поясу ученика.</p>
      {overlap && <p className="w-full text-small text-danger">{overlap}</p>}
      <div className="flex gap-2">
        <Button type="submit">Сохранить урок</Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          Отмена
        </Button>
      </div>
      {error && (
        <p role="alert" className="w-full text-small text-danger">
          {error}
        </p>
      )}
    </form>
  );
}

type Slot = {
  id: string;
  weekday: number;
  startTime: string;
  durationMinutes: number;
  validFrom: string;
  validUntil: string | null;
};

/** «23 ноября» of a plain date. */
const dateLabel = (date: string) => dayMonthIn(new Date(`${date}T12:00:00Z`), "UTC");

/**
 * The student's weekly slots on the card, with «Добавить слот» (#80) and
 * «Изменить слот» from a date (#81): lessons from that date follow the new
 * day and time; earlier ones and the ones changed by hand stay.
 */
export function StudentSlots({ studentId, slots, today }: { studentId: string; slots: Slot[]; today: string }) {
  const router = useRouter();
  // One form at a time: «Добавить слот», or «Изменить слот» of one slot.
  const [form, setForm] = useState<"add" | { slotId: string } | null>(null);
  const [weekday, setWeekday] = useState<number>(WEEKDAYS[0].day);
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState<number>(DEFAULT_DURATION);
  const [from, setFrom] = useState(today);
  const [error, setError] = useState<string | null>(null);

  function open(slot?: Slot) {
    setError(null);
    setForm(slot ? { slotId: slot.id } : "add");
    setWeekday(slot?.weekday ?? WEEKDAYS[0].day);
    setTime(slot?.startTime ?? "");
    setDuration(slot?.durationMinutes ?? DEFAULT_DURATION);
    setFrom(today);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const fields = { weekday, startTime: time, durationMinutes: duration as 45 | 60 | 90 };
    try {
      if (form === "add") await routerClient.teacher.schedule.addSlot.mutate({ studentId, ...fields });
      else if (form) await routerClient.teacher.schedule.changeSlot.mutate({ slotId: form.slotId, ...fields, from });
      setForm(null);
      setTime("");
      router.refresh();
    } catch {
      setError("Не получилось сохранить слот");
    }
  }

  return (
    <section aria-label="Регулярные уроки" className="mt-6 flex flex-col gap-2 border-t border-border pt-4">
      <h2 className="text-small font-semibold text-text-secondary">Регулярные уроки — по времени ученика</h2>
      {slots.length > 0 && (
        <ul className="flex flex-col gap-1">
          {slots.map((slot) => (
            <li key={slot.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                {weekdayLabel(slot.weekday)}, {slot.startTime} · {slot.durationMinutes} мин
                {slot.validFrom > today && ` · с ${dateLabel(slot.validFrom)}`}
                {slot.validUntil && ` · до ${dateLabel(slot.validUntil)} включительно`}
              </span>
              {!slot.validUntil && form === null && (
                <button type="button" onClick={() => open(slot)} className="text-small text-green-600 hover:text-green-700">
                  Изменить слот
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {form ? (
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
          <Labelled id="slot-weekday" label="День недели">
            <select id="slot-weekday" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} className={field}>
              {WEEKDAYS.map((w) => (
                <option key={w.day} value={w.day}>
                  {w.label}
                </option>
              ))}
            </select>
          </Labelled>
          <Labelled id="slot-time" label="Время">
            <input id="slot-time" type="time" required value={time} onChange={(e) => setTime(e.target.value)} className={field} />
          </Labelled>
          <Labelled id="slot-duration" label="Длительность">
            <DurationSelect id="slot-duration" value={duration} onChange={setDuration} />
          </Labelled>
          {form !== "add" && (
            <Labelled id="slot-from" label="С даты">
              <input
                id="slot-from"
                type="date"
                required
                min={today}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className={field}
              />
            </Labelled>
          )}
          <div className="flex gap-2">
            <Button type="submit">Сохранить слот</Button>
            <Button variant="secondary" onClick={() => setForm(null)}>
              Отмена
            </Button>
          </div>
          {form !== "add" && (
            <p className="w-full text-small text-text-secondary">
              Уроки с этой даты пойдут по-новому; прошедшие и перенесённые вручную останутся как есть.
            </p>
          )}
          {error && (
            <p role="alert" className="w-full text-small text-danger">
              {error}
            </p>
          )}
        </form>
      ) : (
        <Button variant="secondary" className="self-start" onClick={() => open()}>
          Добавить слот
        </Button>
      )}
    </section>
  );
}
