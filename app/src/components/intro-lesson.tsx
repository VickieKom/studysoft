"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { DEFAULT_DURATION, DURATIONS } from "@/domain/schedule";
import { type Level, LEVELS } from "@/domain/student";
import { Button } from "./button";
import { routerClient } from "./router-client";

const field = "h-10 rounded-control border border-border bg-bg px-3";
const label = "flex flex-col gap-1 text-small";

/**
 * «Записать на вводный» on a request (#338): a date and a time in the
 * teacher's time zone and the length; the free intro lesson goes on the
 * schedule with the child's name, and the request is «Вводный записан».
 * The request's page shows it at «Заявка» only.
 */
export function IntroBooking({ requestId, today }: { requestId: string; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState<number>(DEFAULT_DURATION);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (!date || !time) return setError("Укажите дату и время");
    setPending(true);
    setError(null);
    try {
      await routerClient.teacher.requests.bookIntro.mutate({ id: requestId, date, time, durationMinutes: duration });
      setOpen(false);
      setTime("");
      router.refresh();
    } catch (cause) {
      const code = (cause as { data?: { code?: string } } | null)?.data?.code;
      // Refused at another stage, or while the intro is on the schedule (#338).
      setError(code === "CONFLICT" && cause instanceof Error ? cause.message : "Не получилось записать. Попробуйте ещё раз");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <div>
        <Button onClick={() => setOpen(true)}>Записать на вводный</Button>
      </div>
    );
  }
  return (
    <form noValidate onSubmit={onSubmit} aria-label="Записать на вводный" className="flex flex-col gap-3 rounded-card border border-border p-4">
      <div className="flex flex-wrap gap-3">
        <label className={label}>
          Дата
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={field} />
        </label>
        <label className={label}>
          Время
          <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className={field} />
        </label>
        <label className={label}>
          Длительность
          <select value={duration} onChange={(event) => setDuration(Number(event.target.value))} className={field}>
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {d} мин
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          Записать
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          Отмена
        </Button>
      </div>
    </form>
  );
}

/** «Итог вводного» (#338): the CEFR level and the teacher's notes, saved with «Сохранить». */
export function IntroOutcome({ requestId, level: savedLevel, notes: savedNotes }: { requestId: string; level: Level | null; notes: string | null }) {
  const router = useRouter();
  const [level, setLevel] = useState<Level | "">(savedLevel ?? "");
  const [notes, setNotes] = useState(savedNotes ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  async function save() {
    setStatus("saving");
    try {
      await routerClient.teacher.requests.saveIntroOutcome.mutate({ id: requestId, level: level || null, notes });
      setStatus("saved");
      router.refresh();
    } catch {
      setStatus("failed");
    }
  }

  return (
    <section aria-label="Итог вводного" className="flex flex-col gap-3 rounded-card border border-border p-4">
      <h2 className="text-h3 font-semibold">Итог вводного</h2>
      <label className={label}>
        Уровень
        <select value={level} onChange={(event) => setLevel(event.target.value as Level | "")} className={`${field} self-start`}>
          <option value="">—</option>
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Заметки
        <textarea value={notes} maxLength={5_000} rows={4} onChange={(event) => setNotes(event.target.value)} className="rounded-control border border-border bg-bg px-3 py-2" />
      </label>
      <div className="flex items-center gap-3">
        <Button disabled={status === "saving"} onClick={save}>
          Сохранить
        </Button>
        <span className="text-small text-text-secondary">
          {status === "saved" ? "Сохранено" : status === "failed" ? "Не сохранилось. Попробуйте ещё раз" : ""}
        </span>
      </div>
    </section>
  );
}
