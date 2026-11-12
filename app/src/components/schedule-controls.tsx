"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useState } from "react";
import { DEFAULT_DURATION, DURATIONS, WEEKDAYS, weekdayLabel } from "@/domain/schedule";
import { Button } from "./button";
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
        <select id="lesson-student" value={studentId} onChange={(e) => setStudentId(e.target.value)} className={field}>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Labelled>
      <Labelled id="lesson-date" label="Дата">
        <input id="lesson-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={field} />
      </Labelled>
      <Labelled id="lesson-time" label="Время">
        <input id="lesson-time" type="time" required value={time} onChange={(e) => setTime(e.target.value)} className={field} />
      </Labelled>
      <Labelled id="lesson-duration" label="Длительность">
        <DurationSelect id="lesson-duration" value={duration} onChange={setDuration} />
      </Labelled>
      <div className="flex h-10 items-center gap-2">
        <input id="lesson-intro" type="checkbox" checked={intro} onChange={(e) => setIntro(e.target.checked)} />
        <label htmlFor="lesson-intro">Вводный урок</label>
      </div>
      <p className="w-full text-small text-text-secondary">Дата и время — по часовому поясу ученика.</p>
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

type Slot = { id: string; weekday: number; startTime: string; durationMinutes: number };

/** The student's weekly slots on the card, with «Добавить слот» (#80). */
export function StudentSlots({ studentId, slots }: { studentId: string; slots: Slot[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [weekday, setWeekday] = useState<number>(WEEKDAYS[0].day);
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState<number>(DEFAULT_DURATION);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await routerClient.teacher.schedule.addSlot.mutate({
        studentId,
        weekday,
        startTime: time,
        durationMinutes: duration as 45 | 60 | 90,
      });
      setOpen(false);
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
            <li key={slot.id}>
              {weekdayLabel(slot.weekday)}, {slot.startTime} · {slot.durationMinutes} мин
            </li>
          ))}
        </ul>
      )}
      {open ? (
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
          <div className="flex gap-2">
            <Button type="submit">Сохранить слот</Button>
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
      ) : (
        <Button variant="secondary" className="self-start" onClick={() => setOpen(true)}>
          Добавить слот
        </Button>
      )}
    </section>
  );
}
