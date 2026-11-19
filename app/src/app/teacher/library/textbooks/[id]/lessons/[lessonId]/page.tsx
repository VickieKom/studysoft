import Link from "next/link";
import { notFound } from "next/navigation";
import { BOOK_LABELS } from "@/domain/textbook";
import { isNotFound } from "@/server/router";
import { teacherCaller } from "../../../../../caller";

export const metadata = { title: "Урок учебника — StudySoft" };

type Props = { params: Promise<{ id: string; lessonId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One lesson of a textbook's confirmed structure (#150): its pages in each book, its tracks and its words. */
export default async function TextbookLessonPage({ params }: Props) {
  const { id, lessonId } = await params;
  if (!UUID.test(id) || !UUID.test(lessonId)) notFound();
  const { caller } = await teacherCaller();
  let lesson;
  try {
    lesson = await caller.teacher.textbooks.lesson({ textbookId: id, lessonId });
  } catch (error) {
    if (isNotFound(error)) notFound();
    throw error;
  }

  return (
    <main className="flex flex-col gap-6">
      <p>
        <Link href={`/teacher/library/textbooks/${id}`} className="text-small text-green-600 hover:text-green-700">
          ← {lesson.textbookTitle}
        </Link>
      </p>
      <header className="flex flex-col gap-1">
        <h1 className="text-h1 font-bold">{lesson.title}</h1>
        <p className="text-text-secondary">{lesson.unit}</p>
      </header>

      {lesson.pages.map((book) => (
        <section key={book.fileId} aria-label={BOOK_LABELS[book.kind]} className="flex flex-col gap-3">
          <h2 className="text-h3 font-semibold">
            {BOOK_LABELS[book.kind]}, стр. {book.from === book.to ? book.from : `${book.from}–${book.to}`}
          </h2>
          <ol className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {Array.from({ length: book.to - book.from + 1 }, (_, i) => book.from + i).map((page) => (
              <li key={page} className="flex flex-col items-center gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element -- served with a permission check, not by the image optimizer */}
                <img
                  src={`/api/files/textbooks/${book.fileId}/pages/${page}`}
                  alt={`Страница ${page}`}
                  loading="lazy"
                  className="w-full rounded-control border border-border"
                />
                <span className="text-caption text-text-muted">{page}</span>
              </li>
            ))}
          </ol>
        </section>
      ))}

      {lesson.tracks.length > 0 && (
        <section aria-label="Треки урока" className="flex flex-col gap-2">
          <h2 className="text-h3 font-semibold">Треки</h2>
          <ul aria-label="Треки" className="flex flex-col gap-2">
            {lesson.tracks.map((track) => (
              <li key={track.id} className="flex flex-wrap items-center gap-3">
                <span className="min-w-16 font-semibold">{track.name}</span>
                <audio controls preload="metadata" src={`/api/files/textbooks/${track.id}`} className="w-full max-w-md" />
              </li>
            ))}
          </ul>
        </section>
      )}

      {lesson.words.length > 0 && (
        <section aria-label="Слова урока" className="flex flex-col gap-2">
          <h2 className="text-h3 font-semibold">Слова</h2>
          <ul aria-label="Слова" className="flex flex-wrap gap-2">
            {lesson.words.map((word, i) => (
              <li key={i} className="rounded-control border border-border px-2 py-1 text-small">
                {word}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
