import Link from "next/link";
import { notFound } from "next/navigation";
import { LibraryDelete } from "@/components/library-delete";
import { AGE_GROUP_LABELS, GAME_SANDBOX, MATERIAL_KIND_FILTERS } from "@/domain/library";
import { isNotFound } from "@/server/router";
import { teacherCaller } from "../../caller";

export const metadata = { title: "Материал — StudySoft" };

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One material (#115). A game runs in a sandboxed frame — scripts, but an
 * origin of its own — so it cannot reach this page or the platform's cookies.
 * A warm-up (#116) is its picture, full width, or its list of questions.
 */
export default async function MaterialPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { caller } = await teacherCaller();
  let material;
  try {
    material = await caller.teacher.library.get({ id });
  } catch (error) {
    if (isNotFound(error)) notFound();
    throw error;
  }

  return (
    <main className="flex flex-col gap-4">
      <p>
        <Link href="/teacher/library" className="text-small text-green-600 hover:text-green-700">
          ← Библиотека
        </Link>
      </p>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-h1 font-bold">{material.title}</h1>
          <p className="flex flex-wrap gap-2 text-small text-text-secondary">
            <span>{MATERIAL_KIND_FILTERS[material.kind]}</span>
            {material.kind === "game" && material.warmup && <span>{MATERIAL_KIND_FILTERS.warmup}</span>}
            <span>{material.level}</span>
            {material.topic && <span>{material.topic}</span>}
            <span>{AGE_GROUP_LABELS[material.ageGroup]}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/teacher/library/${material.id}/edit`}
            className="inline-flex h-10 items-center rounded-control border border-border px-4 text-button font-semibold hover:bg-surface"
          >
            Изменить
          </Link>
          <LibraryDelete id={material.id} />
        </div>
      </header>
      {material.questions ? (
        <ol aria-label="Вопросы" className="flex list-decimal flex-col gap-3 pl-6 text-h3">
          {material.questions.map((question, i) => (
            <li key={i}>{question}</li>
          ))}
        </ol>
      ) : material.kind === "game" && material.fileUrl ? (
        <iframe
          title={material.title}
          src={material.fileUrl}
          sandbox={GAME_SANDBOX}
          referrerPolicy="no-referrer"
          className="h-[70vh] w-full rounded-card border border-border bg-bg"
        />
      ) : (
        material.fileUrl && (
          // biome-ignore lint/performance/noImgElement: the image optimiser fetches without the teacher's session, so a permission-checked file cannot go through it
          // eslint-disable-next-line @next/next/no-img-element -- same reason as above
          <img src={material.fileUrl} alt={material.title} className="w-full rounded-card border border-border" />
        )
      )}
    </main>
  );
}
