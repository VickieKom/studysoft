"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "./button";
import { routerClient } from "./router-client";

/** Paste a homework JSON; on success open the draft, otherwise show what is wrong. */
export function HomeworkImportForm({ studentId }: { studentId: string }) {
  const router = useRouter();
  const [json, setJson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const { id } = await routerClient.teacher.homework.import.mutate({ studentId, json });
      router.push(`/teacher/students/${studentId}/homework/${id}`);
    } catch (caught) {
      const message = (caught as { message?: string })?.message;
      const isFormatError = (caught as { data?: { code?: string } })?.data?.code === "BAD_REQUEST";
      setError(isFormatError && message ? message : "Не удалось импортировать. Попробуйте ещё раз");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label htmlFor="homework-json" className="text-small text-text-secondary">
        JSON домашки
      </label>
      <textarea
        id="homework-json"
        required
        rows={18}
        value={json}
        onChange={(event) => setJson(event.target.value)}
        className="rounded-control border border-border bg-bg px-3 py-2 font-mono text-small outline-none focus:border-green-500"
      />
      {error && (
        <p role="alert" className="whitespace-pre-line rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          Импортировать
        </Button>
      </div>
    </form>
  );
}
