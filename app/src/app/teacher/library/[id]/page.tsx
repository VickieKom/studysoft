import Link from "next/link";
import { notFound } from "next/navigation";
import { LibraryAddDraft } from "@/components/library-add-draft";
import { LibraryDelete } from "@/components/library-delete";
import { LibraryGameFrame } from "@/components/library-game-frame";
import { LibraryOpenToStudent } from "@/components/library-open-to-student";
import { AGE_GROUP_LABELS, likedLabel, MATERIAL_KIND_FILTERS } from "@/domain/library";
import { timeIn } from "@/domain/schedule";
import { isNotFound } from "@/server/router";
import { teacherCaller } from "../../caller";

export const metadata = { title: "Материал — StudySoft" };

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One material (#115). A game runs in a sandboxed frame — scripts, but an
 * origin of its own — so it cannot reach this page or the platform's cookies.
 * A warm-up (#116) is its picture, full width, or its list of questions. A
 * video plays in the page, or its link opens in a new tab (#117). During a
 * lesson the teacher opens a game to the student (#118), or plays it with
 * them on this page: its result goes to that lesson's student (#147).
 * The assistant's draft (#120) says so and offers «Добавить в библиотеку».
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
  const isGame = material.kind === "game";
  // A game or a video is opened to a student during a lesson (#118, #158).
  const opensToStudent = isGame || material.kind === "video";
  const [inLesson, opened] = opensToStudent
    ? await Promise.all([caller.teacher.library.studentsInLesson(), caller.teacher.library.openedTo({ id })])
    : [[], null];
  // A game template without a lesson going on gets the words of a student she picks (#282).
  const allStudents =
    material.kind === "game" && material.vocabulary && inLesson.length === 0
      ? (await caller.teacher.students.list()).map((s) => ({ studentId: s.id, name: s.lastName ? `${s.firstName} ${s.lastName}` : s.firstName }))
      : [];

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
          {material.draft && <p className="text-small font-semibold text-text-secondary">Черновик от ассистента</p>}
          <p className="flex flex-wrap gap-2 text-small text-text-secondary">
            <span>{MATERIAL_KIND_FILTERS[material.kind]}</span>
            {material.kind === "game" && material.warmup && <span>{MATERIAL_KIND_FILTERS.warmup}</span>}
            {material.kind === "game" && material.vocabulary && <span>Со словами словаря</span>}
            {material.textbookLesson && <span>{material.textbookLesson.label}</span>}
            {material.students.length > 0 && <span>Для учеников: {material.students.map((s) => s.name).join(", ")}</span>}
            <span>{material.level}</span>
            {material.topics.map((topic) => (
              <span key={topic}>{topic}</span>
            ))}
            <span>{AGE_GROUP_LABELS[material.ageGroup]}</span>
            {likedLabel(material.likedBy) && <span className="font-semibold text-green-700">{likedLabel(material.likedBy)}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {material.draft && <LibraryAddDraft id={material.id} />}
          <Link
            href={`/teacher/library/${material.id}/edit`}
            className="inline-flex h-10 items-center rounded-control border border-border px-4 text-button font-semibold hover:bg-surface"
          >
            Изменить
          </Link>
          <LibraryDelete id={material.id} />
        </div>
      </header>
      {opensToStudent && (
        <div className="flex flex-col gap-2">
          {opened?.students.map((s) => (
            <p key={s.studentId} className="text-small text-text-secondary">
              {isGame ? "Открыта" : "Открыто"} ученику: {s.name} до {timeIn(new Date(s.until), opened.timeZone)}
            </p>
          ))}
          <LibraryOpenToStudent id={material.id} students={inLesson} kind={isGame ? "game" : "video"} />
        </div>
      )}
      {material.questions ? (
        <ol aria-label="Вопросы" className="flex list-decimal flex-col gap-3 pl-6 text-h3">
          {material.questions.map((question, i) => (
            <li key={i}>{question}</li>
          ))}
        </ol>
      ) : material.kind === "game" && material.fileUrl ? (
        <LibraryGameFrame
          id={material.id}
          title={material.title}
          fileUrl={material.fileUrl}
          students={inLesson}
          withWords={material.vocabulary}
          allStudents={allStudents}
        />
      ) : material.kind === "video" && material.fileUrl ? (
        <video
          src={material.fileUrl}
          controls
          preload="metadata"
          aria-label={material.title}
          className="max-h-[70vh] w-full rounded-card border border-border bg-bg"
        />
      ) : material.kind === "video" && material.url ? (
        <p className="flex flex-col gap-2">
          <a
            href={material.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center self-start rounded-control bg-green-600 px-4 text-button font-semibold text-on-accent hover:bg-green-700"
          >
            Смотреть
          </a>
          <span className="break-all text-small text-text-secondary">{material.url}</span>
        </p>
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
