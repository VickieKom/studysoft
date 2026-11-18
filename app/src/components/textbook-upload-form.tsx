"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState } from "react";
import { LEVELS } from "@/domain/student";
import { BOOK_KINDS, BOOK_LABELS, type BookKind, MAX_BOOK_BYTES, MAX_TRACKS_BYTES } from "@/domain/textbook";
import { Button } from "./button";
import { routerClient } from "./router-client";

/** A refusal the server words for the teacher. */
class Refused extends Error {}

/** Sends a book or a track to the upload address as it is read from disk (#156) and returns its id. */
async function upload(file: File, kind: "book" | "track"): Promise<string> {
  const response = await fetch(`/api/files/textbooks?kind=${kind}`, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  const body = (await response.json().catch(() => null)) as { file?: string; error?: string } | null;
  if (response.ok && body?.file) return body.file;
  throw body?.error ? new Refused(`${file.name}: ${body.error}`) : new Error(`upload failed: ${response.status}`);
}

/** A file's name without its folder and extension: «1-01» for «Tracks/1-01.mp3». */
const shortName = (file: File) => file.name.replace(/\.[^.]+$/, "");

const field = "rounded-control border border-border bg-bg px-3 py-2";

/**
 * «Загрузить учебник» (#156): a title, a level, the books as PDFs and the
 * folder of tracks. The files go first, one by one, then the set; the
 * textbook's page then shows the pages as they are rendered.
 */
export function TextbookUploadForm() {
  const router = useRouter();
  const id = useId();
  const [title, setTitle] = useState("");
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("A1");
  const [books, setBooks] = useState<Partial<Record<BookKind, File>>>({});
  const [tracks, setTracks] = useState<File[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!title.trim()) return setError("Напишите название учебника");
    const chosen = BOOK_KINDS.flatMap((kind) => (books[kind] ? [{ kind, file: books[kind]! }] : []));
    if (chosen.length === 0) return setError("Добавьте хотя бы одну книгу в PDF");
    if (chosen.some(({ file }) => file.size > MAX_BOOK_BYTES)) return setError("Книга больше 300 МБ");
    if (tracks.reduce((sum, file) => sum + file.size, 0) > MAX_TRACKS_BYTES) return setError("Треки вместе больше 500 МБ");
    try {
      const uploadedBooks = [];
      for (const { kind, file } of chosen) {
        setProgress(`Загружается ${BOOK_LABELS[kind]}`);
        uploadedBooks.push({ kind, name: file.name, file: await upload(file, "book") });
      }
      const uploadedTracks = [];
      for (const [i, file] of tracks.entries()) {
        setProgress(`Загружается трек ${i + 1} из ${tracks.length}`);
        uploadedTracks.push({ name: shortName(file), file: await upload(file, "track") });
      }
      setProgress("Сохраняется");
      const { id: textbookId } = await routerClient.teacher.textbooks.create.mutate({
        title: title.trim(),
        level,
        books: uploadedBooks,
        tracks: uploadedTracks,
      });
      router.push(`/teacher/library/textbooks/${textbookId}`);
    } catch (caught) {
      const message = (caught as { message?: string })?.message;
      const isOwn = caught instanceof Refused || (caught as { data?: { code?: string } })?.data?.code === "BAD_REQUEST";
      setError(isOwn && message ? message : "Не получилось загрузить. Попробуйте ещё раз");
      setProgress(null);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-small text-text-secondary">Название</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-small text-text-secondary">Уровень</span>
        <select value={level} onChange={(e) => setLevel(e.target.value as (typeof LEVELS)[number])} className={`${field} h-10`}>
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </label>
      {BOOK_KINDS.map((kind) => (
        <div key={kind} className="flex flex-col gap-1">
          <label htmlFor={`${id}-${kind}`} className="text-small text-text-secondary">
            {BOOK_LABELS[kind]} (PDF)
          </label>
          <input
            id={`${id}-${kind}`}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => setBooks({ ...books, [kind]: e.target.files?.[0] })}
          />
        </div>
      ))}
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-tracks`} className="text-small text-text-secondary">
          Треки
        </label>
        <input
          id={`${id}-tracks`}
          type="file"
          multiple
          accept="audio/*,.mp3,.m4a,.wav,.ogg"
          onChange={(e) => setTracks([...(e.target.files ?? [])].sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true })))}
        />
        <span className="text-caption text-text-muted">Выделите все файлы в папке с треками. MP3, M4A, WAV или OGG, вместе до 500 МБ</span>
      </div>
      {error && (
        <p role="alert" className="rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}
      {progress && !error && (
        <p role="status" className="text-small text-text-secondary">
          {progress}
        </p>
      )}
      <Button type="submit" className="self-start" disabled={progress !== null}>
        Загрузить
      </Button>
    </form>
  );
}

/** «Повторить»: renders a book whose rendering failed again (#156). */
export function TextbookRetry({ fileId }: { fileId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  async function retry() {
    setPending(true);
    setFailed(false);
    try {
      await routerClient.teacher.textbooks.render.mutate({ fileId });
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="secondary" disabled={pending} onClick={retry}>
        Повторить
      </Button>
      {failed && (
        <span role="alert" className="text-small text-danger">
          Не получилось начать заново
        </span>
      )}
    </span>
  );
}
