"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { dateLabel, monthLabel, PROGRESS_SKILLS, type Skill, SKILL_LABELS, type SkillResult, skillsByMonth, trendLabel } from "@/domain/progress";
import { Button } from "./button";
import { routerClient } from "./router-client";

type Totals = {
  homework: { submitted: number; due: number };
  textbook: { title: string; unitsPassed: number; units: number } | null;
  words: { total: number; learnt: number };
};

const field = "rounded-control border border-border bg-bg px-3 py-2";

/**
 * «Прогресс» on the student card (#255): each assessed skill by month with
 * growth or slip, from the results the teacher enters by hand until the
 * monthly assessment writes them; the homework submitted, the textbook
 * covered and the words beside it.
 */
export function StudentProgress({ studentId, results, totals }: { studentId: string; results: SkillResult[]; totals: Totals }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { months, rows } = skillsByMonth(results);
  const dates = [...new Set(results.map((r) => r.measuredOn))].sort().reverse();

  async function run(change: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await change();
      setEditing(null);
      router.refresh();
    } catch (cause) {
      const code = (cause as { data?: { code?: string } } | null)?.data?.code;
      setError(code === "BAD_REQUEST" && cause instanceof Error ? cause.message : "Не получилось сохранить. Попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  }

  const save = (date: string, values: Partial<Record<Skill, number>>, previousDate: string | null) =>
    run(() => routerClient.teacher.progress.save.mutate({ studentId, date, previousDate, results: values }));

  const { homework, textbook, words } = totals;
  return (
    <section aria-labelledby="progress-heading" className="mt-6 flex flex-col gap-4 rounded-card border border-border p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="progress-heading" className="text-h3 font-semibold">
          Прогресс
        </h2>
        {editing !== "new" && (
          <Button variant="secondary" disabled={busy} onClick={() => setEditing("new")}>
            Внести результаты
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-1 text-small">
        <p>
          {homework.due > 0
            ? `Домашки: сдано ${homework.submitted} из ${homework.due} (${Math.round((homework.submitted / homework.due) * 100)}%)`
            : "Домашек со сроком ещё не было"}
        </p>
        <p>{textbook ? `Учебник «${textbook.title}»: пройдено юнитов ${textbook.unitsPassed} из ${textbook.units}` : "Учебник не выбран"}</p>
        <p>{`Слов: ${words.total}, закрепилось ${words.learnt}`}</p>
      </div>

      {editing === "new" && <ResultsForm busy={busy} error={error} onSave={(date, values) => save(date, values, null)} onCancel={() => setEditing(null)} />}

      {rows.length === 0 ? (
        <p className="text-small text-text-secondary">Результатов по навыкам пока нет</p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-label="Навыки по месяцам" className="w-full text-small">
            <thead>
              <tr>
                <th className="px-2 py-1 text-left font-semibold">Навык</th>
                {months.map((m) => (
                  <th key={m} className="px-2 py-1 text-right font-semibold">
                    {monthLabel(m)}
                  </th>
                ))}
                <th className="px-2 py-1 text-right font-semibold">Изменение</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.skill} className="border-t border-border">
                  <th scope="row" className="px-2 py-1 text-left font-normal">
                    {SKILL_LABELS[row.skill]}
                  </th>
                  {months.map((m) => (
                    <td key={m} className="px-2 py-1 text-right">
                      {m in row.byMonth ? `${row.byMonth[m]}%` : "—"}
                    </td>
                  ))}
                  <td className={`px-2 py-1 text-right ${row.trend === null ? "" : row.trend > 0 ? "text-green-700" : row.trend < 0 ? "text-danger" : ""}`}>
                    {row.trend === null ? "—" : trendLabel(row.trend)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dates.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-small font-semibold">Внесённые результаты</h3>
          <ul aria-label="Внесённые результаты" className="flex flex-col gap-2">
            {dates.map((date) => {
              const values = Object.fromEntries(results.filter((r) => r.measuredOn === date).map((r) => [r.skill, r.percent])) as Partial<Record<Skill, number>>;
              return (
                <li key={date} className="flex flex-col gap-2 text-small">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-semibold">{dateLabel(date)}</span>
                    <span className="text-text-secondary">
                      {PROGRESS_SKILLS.filter((s) => values[s] !== undefined)
                        .map((s) => `${SKILL_LABELS[s]} ${values[s]}%`)
                        .join(", ")}
                    </span>
                    {editing !== date && (
                      <span className="flex gap-2">
                        <button type="button" disabled={busy} onClick={() => setEditing(date)} className="text-green-600 hover:text-green-700 disabled:opacity-60">
                          Изменить
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => run(() => routerClient.teacher.progress.delete.mutate({ studentId, date }))}
                          className="text-text-secondary hover:text-danger disabled:opacity-60"
                        >
                          Удалить
                        </button>
                      </span>
                    )}
                  </div>
                  {editing === date && (
                    <ResultsForm
                      start={{ date, values }}
                      busy={busy}
                      error={error}
                      onSave={(next, nextValues) => save(next, nextValues, date)}
                      onCancel={() => setEditing(null)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {error && editing === null && (
        <p role="alert" className="rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

function ResultsForm({
  start,
  busy,
  error,
  onSave,
  onCancel,
}: {
  start?: { date: string; values: Partial<Record<Skill, number>> };
  busy: boolean;
  error: string | null;
  onSave: (date: string, values: Partial<Record<Skill, number>>) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [date, setDate] = useState(start?.date ?? "");
  const [values, setValues] = useState<Record<Skill, string>>(
    Object.fromEntries(PROGRESS_SKILLS.map((s) => [s, start?.values[s] === undefined ? "" : String(start.values[s])])) as Record<Skill, string>,
  );
  const parsed = Object.fromEntries(
    PROGRESS_SKILLS.flatMap((s) => (values[s].trim() === "" ? [] : [[s, Number(values[s])]])),
  ) as Partial<Record<Skill, number>>;
  const valid = date !== "" && Object.keys(parsed).length > 0 && Object.values(parsed).every((p) => Number.isInteger(p) && p! >= 0 && p! <= 100);
  return (
    <fieldset className="flex flex-col gap-3 rounded-control border border-border p-3 text-small">
      <legend className="sr-only">Результаты</legend>
      <label htmlFor={`${id}-date`} className="flex flex-col gap-1">
        <span className="text-text-secondary">Дата</span>
        <input id={`${id}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${field} w-48`} />
      </label>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {PROGRESS_SKILLS.map((skill) => (
          <label key={skill} htmlFor={`${id}-${skill}`} className="flex flex-col gap-1">
            <span className="text-text-secondary">{SKILL_LABELS[skill]}</span>
            <input
              id={`${id}-${skill}`}
              type="number"
              min={0}
              max={100}
              inputMode="numeric"
              value={values[skill]}
              onChange={(e) => setValues({ ...values, [skill]: e.target.value })}
              className={field}
            />
          </label>
        ))}
      </div>
      <p className="text-caption text-text-muted">Проценты от 0 до 100; навык, который не проверяли, оставьте пустым</p>
      {error && (
        <p role="alert" className="rounded-control bg-danger-bg px-3 py-2 text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button disabled={busy || !valid} onClick={() => onSave(date, parsed)}>
          Сохранить
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </fieldset>
  );
}
