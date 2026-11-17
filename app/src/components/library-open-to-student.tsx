"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "./button";
import { routerClient } from "./router-client";

const field = "h-10 rounded-control border border-border bg-bg px-3";

/**
 * «Открыть ученику» on a game's page (#118): offered only while a lesson with
 * at least one student is going on, and lists only those students. The game
 * stays open to the student until an hour after that lesson's end.
 */
export function LibraryOpenToStudent({ id, students }: { id: string; students: { studentId: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [studentId, setStudentId] = useState(students[0]?.studentId ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (students.length === 0) return null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await routerClient.teacher.library.openToStudent.mutate({ id, studentId });
      setOpen(false);
      router.refresh();
    } catch (caught) {
      const message = (caught as { message?: string })?.message;
      const isOwn = (caught as { data?: { code?: string } })?.data?.code === "BAD_REQUEST";
      setError(isOwn && message ? message : "Не получилось открыть игру. Попробуйте ещё раз");
    }
    setPending(false);
  }

  if (!open) {
    return (
      <Button variant="secondary" className="self-start" onClick={() => setOpen(true)}>
        Открыть ученику
      </Button>
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3 rounded-card border border-border p-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="game-student" className="text-small text-text-secondary">
          Ученик
        </label>
        <select id="game-student" value={studentId} onChange={(e) => setStudentId(e.target.value)} className={field}>
          {students.map((s) => (
            <option key={s.studentId} value={s.studentId}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" disabled={pending}>
        Открыть
      </Button>
      <Button variant="secondary" onClick={() => setOpen(false)}>
        Отмена
      </Button>
      <p className="w-full text-small text-text-secondary">Игра будет у ученика до конца урока и ещё час после.</p>
      {error && (
        <p role="alert" className="w-full text-small text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
