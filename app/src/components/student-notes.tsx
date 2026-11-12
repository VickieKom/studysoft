"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState, useSyncExternalStore } from "react";
import { isBlank } from "@/domain/student";
import { Button } from "./button";
import { routerClient } from "./router-client";

type Note = { id: string; body: string; createdAt: string };

const areaClass = "min-h-20 w-full rounded-control border border-border bg-bg px-3 py-2 outline-none focus:border-green-500";

const noChanges = () => () => {};

/**
 * "12 ноября", in the teacher's own browser time zone. The server does not know
 * that zone, so it renders nothing and the browser fills the date in.
 */
function NoteDate({ iso }: { iso: string }) {
  const text = useSyncExternalStore(
    noChanges,
    () => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" }),
    () => "",
  );
  return (
    <time dateTime={iso} className="text-caption text-text-muted">
      {text}
    </time>
  );
}

/** Notes on the student card (#42): newest first, add, edit, delete. Teacher only. */
export function StudentNotes({ studentId, notes }: { studentId: string; notes: Note[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await action();
      router.refresh();
      return true;
    } catch {
      setError("Не удалось сохранить заметку. Попробуйте ещё раз");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function onAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBlank(draft) || pending) return;
    if (await run(() => routerClient.teacher.notes.add.mutate({ studentId, body: draft }))) setDraft("");
  }

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || isBlank(editing.body) || pending) return;
    const { id, body } = editing;
    if (await run(() => routerClient.teacher.notes.update.mutate({ id, body }))) setEditing(null);
  }

  return (
    <section aria-labelledby="notes-heading" className="mt-6 rounded-card border border-border p-6">
      <h2 id="notes-heading" className="mb-4 text-h3 font-semibold">
        Заметки
      </h2>
      <form onSubmit={onAdd} className="mb-6 flex flex-col gap-2">
        <label htmlFor="new-note" className="text-small text-text-secondary">
          Новая заметка
        </label>
        <textarea id="new-note" value={draft} onChange={(event) => setDraft(event.target.value)} className={areaClass} />
        <div>
          <Button type="submit" disabled={pending || isBlank(draft)}>
            Добавить заметку
          </Button>
        </div>
      </form>
      {error && (
        <p role="alert" className="mb-4 rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}
      {notes.length === 0 ? (
        <p className="text-text-secondary">Заметок пока нет</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {notes.map((note) => (
            <li key={note.id} className="border-t border-border pt-4 first:border-t-0 first:pt-0">
              {editing?.id === note.id ? (
                <form onSubmit={onSave} className="flex flex-col gap-2">
                  <label htmlFor={`note-${note.id}`} className="text-small text-text-secondary">
                    Текст заметки
                  </label>
                  <textarea
                    id={`note-${note.id}`}
                    value={editing.body}
                    onChange={(event) => setEditing({ id: note.id, body: event.target.value })}
                    className={areaClass}
                  />
                  <div className="flex gap-2">
                    <Button type="submit" disabled={pending || isBlank(editing.body)}>
                      Сохранить заметку
                    </Button>
                    <Button variant="secondary" onClick={() => setEditing(null)}>
                      Отмена
                    </Button>
                  </div>
                </form>
              ) : (
                <>
                  <p className="whitespace-pre-line">{note.body}</p>
                  <div className="mt-1 flex items-center gap-3">
                    <NoteDate iso={note.createdAt} />
                    <button
                      type="button"
                      className="text-small text-green-600 hover:text-green-700"
                      onClick={() => setEditing({ id: note.id, body: note.body })}
                    >
                      Изменить заметку
                    </button>
                    <button
                      type="button"
                      className="text-small text-danger"
                      disabled={pending}
                      onClick={() => run(() => routerClient.teacher.notes.delete.mutate({ id: note.id }))}
                    >
                      Удалить заметку
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
