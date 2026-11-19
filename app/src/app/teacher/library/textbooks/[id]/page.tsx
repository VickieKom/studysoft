import Link from "next/link";
import { notFound } from "next/navigation";
import { TextbookRetry } from "@/components/textbook-upload-form";
import { BOOK_LABELS, RENDER_LABELS } from "@/domain/textbook";
import { isNotFound } from "@/server/router";
import { teacherCaller } from "../../../caller";

export const metadata = { title: "Учебник — StudySoft" };

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One textbook set (#156): each book's rendering status, then its pages, and
 * the tracks, which play. The pages and the tracks are served to this teacher
 * only, after a permission check.
 */
export default async function TextbookPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { caller } = await teacherCaller();
  let textbook;
  try {
    textbook = await caller.teacher.textbooks.get({ id });
  } catch (error) {
    if (isNotFound(error)) notFound();
    throw error;
  }

  return (
    <main className="flex flex-col gap-6">
      <p>
        <Link href="/teacher/library/textbooks" className="text-small text-green-600 hover:text-green-700">
          ← Учебники
        </Link>
      </p>
      <header className="flex flex-col gap-1">
        <h1 className="text-h1 font-bold">{textbook.title}</h1>
        <p className="text-text-secondary">{textbook.level}</p>
      </header>

      {textbook.books.map((book) => (
        <section key={book.id} aria-label={BOOK_LABELS[book.kind]} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-h3 font-semibold">{BOOK_LABELS[book.kind]}</h2>
            <span className="text-small text-text-secondary">{RENDER_LABELS[book.status]}</span>
            {book.status === "failed" && <TextbookRetry fileId={book.id} />}
          </div>
          {book.status === "rendering" && <p className="text-small text-text-secondary">Страницы появятся, когда книга будет готова</p>}
          {book.status === "done" && (
            <ol className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {Array.from({ length: book.pageCount }, (_, i) => (
                <li key={i} className="flex flex-col items-center gap-1">
                  {/* eslint-disable-next-line @next/next/no-img-element -- served with a permission check, not by the image optimizer */}
                  <img
                    src={`/api/files/textbooks/${book.id}/pages/${i + 1}`}
                    alt={`Страница ${i + 1}`}
                    loading="lazy"
                    className="w-full rounded-control border border-border"
                  />
                  <span className="text-caption text-text-muted">{i + 1}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      ))}

      {textbook.tracks.length > 0 && (
        <section aria-label="Треки по порядку" className="flex flex-col gap-3">
          <h2 className="text-h3 font-semibold">Треки</h2>
          <ul aria-label="Треки" className="flex flex-col gap-2">
            {textbook.tracks.map((track) => (
              <li key={track.id} className="flex flex-wrap items-center gap-3">
                <span className="min-w-16 font-semibold">{track.name}</span>
                <audio controls preload="metadata" src={`/api/files/textbooks/${track.id}`} className="w-full max-w-md" />
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
