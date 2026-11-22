"use client";

import { useEffect, useRef, useState } from "react";
import { type BriefAnswer, type BriefQuestion, type ConvenientTime, MAX_BRIEF_NOTE, MAX_TIME_RANGES, WEEKDAYS } from "@/domain/brief";
import { TIME_ZONES } from "@/domain/student";
import { Button } from "./button";
import { routerClient } from "./router-client";

type Brief = { questions: BriefQuestion[]; answers: Record<string, BriefAnswer>; convenientTime: ConvenientTime };

const field = "h-10 rounded-control border border-border bg-bg px-3";
const empty: BriefAnswer = { choices: [], note: "" };

/**
 * «Бриф» on a request (#339), filled in during the intro: each question of
 * the template with its quick choices, several at once, and a short note for
 * «другое»; «Удобное время» — days and time ranges in the family's time zone.
 * Saved as she goes, one save at a time, the latest state last; «Сохранено»
 * once nothing is waiting.
 */
export function RequestBrief({ requestId, brief: loaded }: { requestId: string; brief: Brief }) {
  const [brief, setBrief] = useState<Brief>(loaded);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const latest = useRef(brief);
  const dirty = useRef(false);
  const saving = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function flush() {
    if (saving.current || !dirty.current) return;
    saving.current = true;
    dirty.current = false;
    setStatus("saving");
    try {
      await routerClient.teacher.requests.saveBrief.mutate({ id: requestId, ...latest.current });
      saving.current = false;
      if (dirty.current) void flush();
      else setStatus("saved");
    } catch {
      saving.current = false;
      setStatus("failed");
    }
  }

  function change(next: Brief, now = true) {
    latest.current = next;
    dirty.current = true;
    setBrief(next);
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), now ? 0 : 500);
  }

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // Shown from the state; changed from the latest, so two quick changes never drop one.
  const answer = (id: string) => brief.answers[id] ?? empty;
  const current = (id: string) => latest.current.answers[id] ?? empty;
  const setAnswer = (id: string, next: BriefAnswer, now = true) => change({ ...latest.current, answers: { ...latest.current.answers, [id]: next } }, now);
  const time = brief.convenientTime;
  const setTime = (edit: (time: ConvenientTime) => ConvenientTime) => change({ ...latest.current, convenientTime: edit(latest.current.convenientTime) });

  return (
    <section aria-label="Бриф" className="flex flex-col gap-4 rounded-card border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-h3 font-semibold">Бриф</h2>
        <span className="text-small text-text-secondary" aria-live="polite">
          {status === "saved" ? "Сохранено" : status === "saving" ? "Сохраняется…" : status === "failed" ? "Не сохранилось — проверьте интернет" : ""}
        </span>
      </div>
      {brief.questions.map((question) => (
        <div key={question.id} role="group" aria-label={question.text} className="flex flex-col gap-2">
          <span className="font-semibold">{question.text}</span>
          <div className="flex flex-wrap gap-3 text-small">
            {question.options.map((option) => (
              <label key={option} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={answer(question.id).choices.includes(option)}
                  onChange={(event) => {
                    const was = current(question.id);
                    const choices = event.target.checked ? [...was.choices, option] : was.choices.filter((c) => c !== option);
                    setAnswer(question.id, { ...was, choices });
                  }}
                />
                {option}
              </label>
            ))}
          </div>
          <label className="flex flex-col gap-1 text-small">
            Заметка
            <textarea
              value={answer(question.id).note}
              maxLength={MAX_BRIEF_NOTE}
              rows={2}
              placeholder="другое или подробнее"
              onChange={(event) => setAnswer(question.id, { ...current(question.id), note: event.target.value }, false)}
              className="rounded-control border border-border bg-bg px-3 py-2"
            />
          </label>
        </div>
      ))}
      <div role="group" aria-label="Удобное время" className="flex flex-col gap-2">
        <span className="font-semibold">Удобное время</span>
        <label className="flex flex-col gap-1 text-small">
          Часовой пояс семьи
          <select value={time.timeZone} onChange={(event) => setTime((t) => ({ ...t, timeZone: event.target.value as ConvenientTime["timeZone"] }))} className={field}>
            {TIME_ZONES.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-3 text-small">
          {WEEKDAYS.map((day) => (
            <label key={day} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={time.days.includes(day)}
                onChange={(event) => {
                  const on = event.target.checked;
                  setTime((t) => ({ ...t, days: on ? WEEKDAYS.filter((d) => d === day || t.days.includes(d)) : t.days.filter((d) => d !== day) }));
                }}
              />
              {day}
            </label>
          ))}
        </div>
        {time.ranges.length > 0 && (
          <ul className="flex flex-wrap gap-2 text-small">
            {time.ranges.map((range, i) => (
              <li key={i} className="flex items-center gap-1 rounded-full border border-border px-3 py-1">
                {range.from}–{range.to}
                <button
                  type="button"
                  aria-label={`Убрать промежуток ${range.from}–${range.to}`}
                  onClick={() => setTime((t) => ({ ...t, ranges: t.ranges.filter((_, n) => n !== i) }))}
                  className="text-text-secondary"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        {time.ranges.length < MAX_TIME_RANGES && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-small">
              С
              <input type="time" value={from} onChange={(event) => setFrom(event.target.value)} className={field} />
            </label>
            <label className="flex flex-col gap-1 text-small">
              До
              <input type="time" value={to} onChange={(event) => setTo(event.target.value)} className={field} />
            </label>
            <Button
              variant="secondary"
              disabled={!from || !to || from >= to}
              onClick={() => {
                setTime((t) => ({ ...t, ranges: [...t.ranges, { from, to }] }));
                setFrom("");
                setTo("");
              }}
            >
              Добавить промежуток
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
