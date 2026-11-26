import Link from "next/link";
import { notFound } from "next/navigation";
import { TextbookStructureEditor } from "@/components/textbook-structure-editor";
import { TextbookTaskBank } from "@/components/textbook-task-bank";
import { TextbookAddTeachersBook, TextbookRetry } from "@/components/textbook-upload-form";
import { BOOK_LABELS, RENDER_LABELS } from "@/domain/textbook";
import { isNotFound } from "@/server/router";
import { teacherCaller } from "../../../caller";

export const metadata = { title: "Учебник — StudySoft" };

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One textbook set (#156): its units and lessons (#150), the task bank lesson
 * by lesson (#224), each book's rendering status, then its pages, and the
 * tracks, which play. The pages and the tracks are served to this teacher
 * only, after a permission check.
 */
export default async function TextbookPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { caller } = await teacherCaller();
  let textbook;
  let structure;
  let bank;
  try {
    [textbook, structure, bank] = await Promise.all([
      caller.teacher.textbooks.get({ id }),
      caller.teacher.textbooks.structure({ id }),
      caller.teacher.textbooks.taskBank({ id }),
    ]);
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

      <section aria-label="Структура" className="flex flex-col gap-3 rounded-card border border-border p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-h3 font-semibold">Юниты и уроки</h2>
          <span className="text-small text-text-secondary">
            {structure.draftBy === "assistant"
              ? "Черновик от ассистента"
              : structure.draftBy === "teacher"
                ? "Черновик, не подтверждён"
                : structure.structure
                  ? "Подтверждена"
                  : "Не размечен"}
          </span>
        </div>
        {structure.structure && (
          <ol className="flex flex-col gap-2">
            {structure.structure.units.map((unit) => (
              <li key={unit.id}>
                <span className="font-semibold">{unit.title}</span>
                <ul className="mt-1 flex flex-wrap gap-2">
                  {unit.lessons.map((lesson) => (
                    <li key={lesson.id}>
                      <Link
                        href={`/teacher/library/textbooks/${textbook.id}/lessons/${lesson.id}`}
                        className="inline-flex rounded-control border border-border px-3 py-1 text-small hover:bg-surface"
                      >
                        {lesson.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
        <TextbookStructureEditor
          key={`${structure.revision}:${structure.structureRevision}`}
          textbookId={textbook.id}
          start={structure.draft ?? structure.structure}
          open={structure.draft !== null}
          revision={structure.revision}
          books={textbook.books.filter((b) => b.status === "done").map((b) => b.kind)}
        />
      </section>

      <TextbookTaskBank textbookId={textbook.id} lessons={bank} />

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

      {!textbook.books.some((b) => b.kind === "teachers_book") && (
        <section aria-label="Добавить Teacher's Book" className="flex flex-col gap-3 rounded-card border border-border p-4">
          <h2 className="text-h3 font-semibold">{BOOK_LABELS.teachers_book}</h2>
          <TextbookAddTeachersBook textbookId={textbook.id} />
        </section>
      )}

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
      {textbook.videos.length > 0 && (
        <section aria-label="Видео учебника" className="flex flex-col gap-3">
          <h2 className="text-h3 font-semibold">Видео</h2>
          <ul aria-label="Видео" className="flex flex-col gap-3">
            {textbook.videos.map((video) => (
              <li key={video.id} className="flex flex-col gap-2">
                <span className="font-semibold">{video.name}</span>
                {/* biome-ignore lint/a11y/useMediaCaption: a textbook's video comes without captions */}
                <video controls playsInline preload="metadata" src={`/api/files/textbooks/${video.id}`} className="w-full max-w-xl rounded-card border border-border bg-black" />
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
