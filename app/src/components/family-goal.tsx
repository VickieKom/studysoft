"use client";

import { useState } from "react";
import { MEASURE_RESET_WARNING, measureField, measureLabel, sameMeasure } from "@/domain/student";
import { Button } from "./button";
import { routerClient } from "./router-client";

type Goal = { familyGoal: string | null; measureName: string | null; measureUnit: string | null };

const field = "rounded-control border border-border bg-bg px-3 py-2";

/**
 * «Цель и показатель» on the card (#266): the family's goal and a personal
 * measure of the teacher's own, a name and a unit; the numbers come from
 * marking lessons «Проведён», and the card shows the last 30 days as first →
 * last.
 */
export function FamilyGoal({ studentId, goal, values }: { studentId: string; goal: Goal; values: number[] }) {
  const [saved, setSaved] = useState(goal);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ familyGoal: goal.familyGoal ?? "", measureName: goal.measureName ?? "", measureUnit: goal.measureUnit ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await routerClient.teacher.goal.save.mutate({ studentId, ...draft });
      const name = draft.measureName.trim() || null;
      setSaved({ familyGoal: draft.familyGoal.trim() || null, measureName: name, measureUnit: name ? draft.measureUnit.trim() || null : null });
      setEditing(false);
    } catch {
      setError("Не получилось сохранить. Проверьте интернет и попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  }

  // Another measure starts from zero (#279): the server erased the numbers, the card shows none until the next load counts again.
  const shown = saved.measureName && sameMeasure(saved, goal) ? measureLabel(saved.measureName, saved.measureUnit, values) : null;
  // The measure as the form would save it, to warn before its numbers are erased.
  const draftName = draft.measureName.trim() || null;
  const changing = saved.measureName !== null && !sameMeasure(saved, { measureName: draftName, measureUnit: draftName ? draft.measureUnit.trim() || null : null });

  return (
    <section aria-label="Цель и показатель" className="mt-6 flex flex-col gap-2 border-t border-border pt-4">
      <h2 className="text-small font-semibold text-text-secondary">Цель и показатель</h2>
      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-small text-text-secondary">Цель семьи</span>
            <textarea rows={2} maxLength={1000} value={draft.familyGoal} onChange={(e) => setDraft({ ...draft, familyGoal: e.target.value })} className={field} />
          </label>
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-small text-text-secondary">Показатель</span>
              <input maxLength={100} value={draft.measureName} onChange={(e) => setDraft({ ...draft, measureName: e.target.value })} className={`${field} h-10`} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-small text-text-secondary">Единица</span>
              <input maxLength={30} value={draft.measureUnit} onChange={(e) => setDraft({ ...draft, measureUnit: e.target.value })} className={`${field} h-10 w-28`} />
            </label>
          </div>
          <p className="text-small text-text-secondary">Число по показателю вносится при отметке урока «Проведён»</p>
          {changing && (
            <p role="status" className="text-small text-danger">
              {MEASURE_RESET_WARNING}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              Сохранить
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setEditing(false)}>
              Отмена
            </Button>
          </div>
        </form>
      ) : (
        <>
          <p className={saved.familyGoal ? "whitespace-pre-line" : "text-text-secondary"}>{saved.familyGoal ?? "Цель не задана"}</p>
          {saved.measureName &&
            (shown ? (
              <p className="font-semibold">{shown}</p>
            ) : (
              <p>
                <span className="font-semibold">{measureField(saved.measureName, saved.measureUnit)}</span>
                <span className="text-text-secondary"> · Пока нет значений</span>
              </p>
            ))}
          <Button variant="secondary" className="self-start" onClick={() => setEditing(true)}>
            Настроить
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
