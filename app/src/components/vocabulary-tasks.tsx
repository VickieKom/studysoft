"use client";

import { useState } from "react";
import type { Task } from "@/domain/homework-format";
import {
  canChooseTranslation,
  canMatch,
  TOO_FEW_FOR_CHOICE,
  VOCABULARY_TASK_LABELS,
  VOCABULARY_TASK_TYPES,
  type VocabularyTaskType,
  vocabularyTasks,
} from "@/domain/vocabulary-homework";
import { routerClient } from "./router-client";

type Word = { id: string; word: string; translation: string; ticked: boolean };

const control =
  "inline-flex h-9 items-center rounded-control border border-border px-3 text-small font-semibold hover:bg-surface disabled:opacity-60";

/**
 * «Из словаря» in the draft editor (#281): the student's words with a
 * translation, the last lesson's and the weak ones ticked; the teacher
 * picks words and task types, and the tasks are added to the draft with
 * their keys. `onAdd` saves them like any edit; true when it went through.
 */
export function VocabularyTasks({ homeworkId, disabled, onAdd }: { homeworkId: string; disabled: boolean; onAdd: (tasks: Task[]) => Promise<boolean> }) {
  const [words, setWords] = useState<Word[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [types, setTypes] = useState<Set<VocabularyTaskType>>(new Set());
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setError(null);
    try {
      const loaded = await routerClient.teacher.homework.vocabulary.query({ id: homeworkId });
      setWords(loaded);
      setChosen(new Set(loaded.filter((w) => w.ticked).map((w) => w.id)));
      setTypes(new Set());
    } catch {
      setError("Не получилось открыть словарь. Проверьте интернет и попробуйте ещё раз");
    }
  }

  if (!words) {
    return (
      <div className="flex flex-col gap-2">
        <button type="button" className={`${control} self-start`} disabled={disabled} onClick={() => void open()}>
          Из словаря
        </button>
        {error && (
          <p role="alert" className="text-small text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  const picked = words.filter((w) => chosen.has(w.id));
  const available: Record<VocabularyTaskType, boolean> = { match: canMatch(picked), choose_translation: canChooseTranslation(words) };
  const toggle = <T,>(set: Set<T>, value: T) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };
  const wanted = VOCABULARY_TASK_TYPES.filter((t) => types.has(t) && available[t]);

  async function add() {
    if (!words) return;
    if (await onAdd(vocabularyTasks(picked, words, wanted))) setWords(null);
  }

  return (
    <div role="group" aria-label="Из словаря" className="flex flex-col gap-3 rounded-card border border-border p-4">
      <p className="font-semibold">Из словаря</p>
      {words.length === 0 ? (
        <p className="text-small text-text-secondary">В словаре ученика нет слов с переводом</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {words.map((w) => (
            <li key={w.id}>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={chosen.has(w.id)} onChange={() => setChosen(toggle(chosen, w.id))} />
                {w.word} — {w.translation}
              </label>
            </li>
          ))}
        </ul>
      )}
      <fieldset className="flex flex-col gap-1">
        <legend className="text-small text-text-secondary">Задания</legend>
        {VOCABULARY_TASK_TYPES.map((type) => (
          <div key={type} className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" disabled={type === "choose_translation" && !available[type]} checked={types.has(type)} onChange={() => setTypes(toggle(types, type))} />
              {VOCABULARY_TASK_LABELS[type]}
            </label>
            {type === "choose_translation" && !available[type] && <span className="text-small text-text-secondary">{TOO_FEW_FOR_CHOICE}</span>}
          </div>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={control} disabled={disabled || wanted.length === 0} onClick={() => void add()}>
          Добавить
        </button>
        <button type="button" className={control} onClick={() => setWords(null)}>
          Отмена
        </button>
      </div>
    </div>
  );
}
