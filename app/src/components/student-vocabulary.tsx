"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { todayIn } from "@/domain/homework";
import { dayMonthIn } from "@/domain/schedule";
import { addDays, WORD_MARK_LABELS, type WordMark } from "@/domain/word-training";
import { Button } from "./button";
import { routerClient } from "./router-client";

type Draft = { translation: string | null; example: string | null };
type Word = {
  id: string;
  word: string;
  translation: string | null;
  example: string | null;
  draft: Draft | null;
  mark: WordMark | null;
  trainedAt: string | null;
  addedAt: string;
};
type Fields = { word: string; translation: string; example: string };

const field = "rounded-control border border-border bg-bg px-3 py-2";

/**
 * «Словарь» on the student card (#154): the words added when lessons were
 * finished — the book lesson's and those the teacher noted on the panel —
 * and by hand, newest first, each with its translation and example if any
 * and the day it was added. The teacher corrects, deletes and adds words
 * here (#236); the student sees them in «Тренировка слов». The assistant's
 * translations and examples wait «от ассистента» by each word until the
 * teacher confirms them, one by one or all at once (#237).
 * After the
 * student's training each word is marked, and a line counts what is learnt
 * and says when the last training was (#240).
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

  const drafts = words.filter((w) => w.draft);
  const confirm = (list: Word[]) =>
    run(() =>
      routerClient.teacher.students.confirmWordDrafts.mutate({
        studentId,
        words: list.map((w) => ({ id: w.id, translation: w.draft!.translation, example: w.draft!.example })),
      }),
    );

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
        <div className="flex flex-wrap gap-2">
          {drafts.length > 0 && (
            <Button variant="secondary" disabled={busy} onClick={() => void confirm(drafts)}>
              Подтвердить все
            </Button>
          )}
          {editing !== "new" && (
            <Button variant="secondary" disabled={busy} onClick={() => open("new")}>
              Добавить слово
            </Button>
          )}
        </div>
      </div>
      {words.length > 0 && <p className="text-small text-text-secondary">{progressLine(words, timeZone)}</p>}
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
                  {w.mark && <span className={`rounded-full px-2 text-caption ${MARK_STYLE[w.mark]}`}>{WORD_MARK_LABELS[w.mark]}</span>}
                  {w.example && <span className="basis-full text-text-secondary">{w.example}</span>}
                  {w.draft && (
                    <span className="flex basis-full flex-wrap items-center gap-2 rounded-control bg-surface px-2 py-1">
                      <span className="text-text-secondary">от ассистента:</span>
                      {w.draft.translation && <span>{w.draft.translation}</span>}
                      {w.draft.example && <span className="text-text-secondary">{w.draft.example}</span>}
                      <button type="button" disabled={busy} onClick={() => void confirm([w])} className="font-semibold text-green-600 hover:text-green-700 disabled:opacity-60">
                        Подтвердить
                      </button>
                    </span>
                  )}
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

const MARK_STYLE: Record<WordMark, string> = {
  learnt: "bg-green-100 text-green-700",
  often_wrong: "bg-danger-bg text-danger",
  learning: "bg-surface text-text-secondary",
};

/** «Закреплено 12 из 40, последняя тренировка — вчера» (#240): the day in the teacher's time zone. */
function progressLine(words: Word[], timeZone: string): string {
  const learnt = words.filter((w) => w.mark === "learnt").length;
  const last = words.reduce<string | null>((latest, w) => (w.trainedAt && (!latest || w.trainedAt > latest) ? w.trainedAt : latest), null);
  const head = `Закреплено ${learnt} из ${words.length}`;
  if (!last) return `${head}, тренировок ещё не было`;
  const today = todayIn(timeZone);
  const day = todayIn(timeZone, new Date(last));
  const when = day === today ? "сегодня" : day === addDays(today, -1) ? "вчера" : dayMonthIn(new Date(last), timeZone);
  return `${head}, последняя тренировка — ${when}`;
}
