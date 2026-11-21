"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { dayMonthIn } from "@/domain/schedule";
import { Button } from "./button";
import { routerClient } from "./router-client";

type Word = { id: string; word: string; translation: string | null; example: string | null; addedAt: string };
type Fields = { word: string; translation: string; example: string };

const field = "rounded-control border border-border bg-bg px-3 py-2";

/**
 * «Словарь» on the student card (#154): the words added when lessons were
 * finished — the book lesson's and those the teacher noted on the panel —
 * and by hand, newest first, each with its translation and example if any
 * and the day it was added. The teacher corrects, deletes and adds words
 * here (#236); the student sees them in «Тренировка слов».
 */
export function StudentVocabulary({ studentId, words, timeZone }: { studentId: string; words: Word[]; timeZone: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(change: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await change();
      setEditing(null);
      router.refresh();
    } catch (cause) {
      const code = (cause as { data?: { code?: string } } | null)?.data?.code;
      setError(code === "CONFLICT" && cause instanceof Error ? cause.message : "Не получилось сохранить. Попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  }

  const open = (target: string | "new" | null) => {
    setError(null);
    setEditing(target);
  };

  return (
    <section aria-labelledby="vocabulary-heading" className="mt-6 flex flex-col gap-4 rounded-card border border-border p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="vocabulary-heading" className="text-h3 font-semibold">
          Словарь
        </h2>
        {editing !== "new" && (
          <Button variant="secondary" disabled={busy} onClick={() => open("new")}>
            Добавить слово
          </Button>
        )}
      </div>
      {editing === "new" && (
        <WordForm
          legend="Новое слово"
          start={{ word: "", translation: "", example: "" }}
          busy={busy}
          error={error}
          onSave={(fields) => run(() => routerClient.teacher.students.addWord.mutate({ studentId, ...fields }))}
          onCancel={() => open(null)}
        />
      )}
      {words.length === 0 ? (
        <p className="text-small text-text-secondary">Слова появятся после «Завершить урок»</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {words.map((w) => (
            <li key={w.id} className="flex flex-col gap-2 text-small">
              {editing === w.id ? (
                <WordForm
                  legend={`Слово ${w.word}`}
                  start={{ word: w.word, translation: w.translation ?? "", example: w.example ?? "" }}
                  busy={busy}
                  error={error}
                  onSave={(fields) => run(() => routerClient.teacher.students.updateWord.mutate({ studentId, id: w.id, ...fields }))}
                  onCancel={() => open(null)}
                />
              ) : (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-semibold">{w.word}</span>
                  {w.translation && <span>— {w.translation}</span>}
                  <span className="text-text-secondary">· {dayMonthIn(new Date(w.addedAt), timeZone)}</span>
                  {w.example && <span className="basis-full text-text-secondary">{w.example}</span>}
                  <span className="flex gap-2">
                    <button type="button" disabled={busy} onClick={() => open(w.id)} className="text-green-600 hover:text-green-700 disabled:opacity-60">
                      Изменить
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(() => routerClient.teacher.students.deleteWord.mutate({ studentId, id: w.id }))}
                      className="text-text-secondary hover:text-danger disabled:opacity-60"
                    >
                      Удалить
                    </button>
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && editing === null && (
        <p role="alert" className="rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

function WordForm({
  legend,
  start,
  busy,
  error,
  onSave,
  onCancel,
}: {
  legend: string;
  start: Fields;
  busy: boolean;
  error: string | null;
  onSave: (fields: Fields) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [fields, setFields] = useState(start);
  const set = (key: keyof Fields) => (event: React.ChangeEvent<HTMLInputElement>) => setFields({ ...fields, [key]: event.target.value });
  return (
    <fieldset className="flex flex-col gap-2 rounded-control border border-border p-3">
      <legend className="sr-only">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <label htmlFor={`${id}-word`} className="flex flex-col gap-1">
          <span className="text-text-secondary">Слово</span>
          <input id={`${id}-word`} value={fields.word} onChange={set("word")} className={field} />
        </label>
        <label htmlFor={`${id}-translation`} className="flex flex-col gap-1">
          <span className="text-text-secondary">Перевод</span>
          <input id={`${id}-translation`} value={fields.translation} onChange={set("translation")} className={field} />
        </label>
      </div>
      <label htmlFor={`${id}-example`} className="flex flex-col gap-1">
        <span className="text-text-secondary">Пример</span>
        <input id={`${id}-example`} value={fields.example} onChange={set("example")} className={field} />
      </label>
      {error && (
        <p role="alert" className="rounded-control bg-danger-bg px-3 py-2 text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button disabled={busy || fields.word.trim() === ""} onClick={() => onSave(fields)}>
          Сохранить
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </fieldset>
  );
}
