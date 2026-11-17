"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "./button";
import { routerClient } from "./router-client";

type Summary = { imported: number; existing: number; errors: string[] };

/**
 * «Загрузить историю» (#38): the results history from the old tool, a CSV in
 * the history import format. The file is read here and sent as text; the
 * server imports it and never keeps the file.
 */
export function HistoryUpload() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setPending(true);
    setError(null);
    setSummary(null);
    try {
      setSummary(await routerClient.teacher.history.import.mutate({ csv: await file.text() }));
      router.refresh();
    } catch {
      setError("Не получилось загрузить файл. Проверьте, что это CSV до 5 МБ, и попробуйте ещё раз");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="history-heading" className="mt-8 rounded-card border border-border p-6">
      <h2 id="history-heading" className="text-h3 font-semibold">
        История из прошлого инструмента
      </h2>
      <p className="mt-1 text-small text-text-secondary">
        CSV в формате импорта истории: строка на ответ. Повторная загрузка того же файла ничего не добавит.
      </p>
      <form onSubmit={onSubmit} className="mt-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="history-file" className="text-small text-text-secondary">
            CSV с историей домашек
          </label>
          <input
            id="history-file"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </div>
        <Button type="submit" disabled={pending || !file}>
          Загрузить историю
        </Button>
      </form>
      {summary && (
        <div role="status" className="mt-4 flex flex-col gap-1 text-small">
          <p>
            Загружено сдач: {summary.imported}. Уже были: {summary.existing}.
          </p>
          {summary.errors.length > 0 && (
            <>
              <p className="font-semibold">Не загружены строки:</p>
              <ul className="list-disc pl-5 text-danger">
                {summary.errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-4 rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
