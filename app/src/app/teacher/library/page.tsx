import Link from "next/link";
import { LibraryFilters } from "@/components/library-filters";
import { AGE_GROUP_LABELS, AGE_GROUPS, MATERIAL_KIND_FILTERS, MATERIAL_KINDS } from "@/domain/library";
import { LEVELS } from "@/domain/student";
import { teacherCaller } from "../caller";

export const metadata = { title: "Библиотека — StudySoft" };

type Props = { searchParams: Promise<{ type?: string; level?: string; topic?: string; age?: string; book?: string; lesson?: string; student?: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOf = (value: string | undefined) => (value && UUID.test(value) ? value : undefined);

const pick = <T extends string>(values: readonly T[], value: string | undefined): T | undefined =>
  values.find((v) => v === value);

const tab = "rounded-control px-3 py-1.5 text-small font-semibold";

/**
 * «Библиотека» (#115): the teacher's materials by type, level, topic and age.
 * The assistant's drafts (#120) are listed above it under «От ассистента»,
 * never in the list or its filters, and the block is gone when there are none.
 */
export default async function LibraryPage({ searchParams }: Props) {
  const params = await searchParams;
  const filter = {
    kind: pick(MATERIAL_KINDS, params.type),
    level: pick(LEVELS, params.level),
    topic: params.topic && params.topic.length <= 100 ? params.topic : undefined,
    ageGroup: pick(AGE_GROUPS, params.age),
    // «Учебник» and «Урок» (#291).
    textbookId: uuidOf(params.book),
    lessonId: uuidOf(params.book) ? uuidOf(params.lesson) : undefined,
    // «Ученик» (#292).
    studentId: uuidOf(params.student),
  };
  const { caller } = await teacherCaller();
  const { materials, topics, total } = await caller.teacher.library.list(filter);
  const drafts = await caller.teacher.library.drafts();
  const textbooks = await caller.teacher.library.textbooks();
  const students = (await caller.teacher.students.list()).map((s) => ({ id: s.id, name: s.lastName ? `${s.firstName} ${s.lastName}` : s.firstName }));
  const tabs: { label: string; href: string; current: boolean }[] = [
    { label: "Все", href: "/teacher/library", current: !filter.kind },
    ...MATERIAL_KINDS.map((kind) => ({
      label: MATERIAL_KIND_FILTERS[kind],
      href: `/teacher/library?type=${kind}`,
      current: filter.kind === kind,
    })),
  ];

  return (
    <main className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-h1 font-bold">Библиотека</h1>
        <span className="flex items-center gap-3">
          <Link href="/teacher/library/textbooks" className="text-button font-semibold text-green-600 hover:text-green-700">
            Учебники
          </Link>
          <Link
          href="/teacher/library/new"
          className="inline-flex h-10 items-center rounded-control bg-green-600 px-4 text-button font-semibold text-on-accent hover:bg-green-700"
        >
          Загрузить
          </Link>
        </span>
      </header>
      {drafts.length > 0 && (
        <section aria-labelledby="drafts-heading" className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
          <h2 id="drafts-heading" className="text-h3 font-semibold">
            От ассистента
          </h2>
          <ul className="flex flex-col gap-2">
            {drafts.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3">
                <span className="font-semibold">{d.title}</span>
                <span className="text-caption text-text-secondary">{MATERIAL_KIND_FILTERS[d.kind]}</span>
                <Link href={`/teacher/library/${d.id}`} className="text-small text-green-600 hover:text-green-700">
                  Открыть
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {total === 0 ? (
        <div className="rounded-card border border-border bg-surface px-6 py-12 text-center text-text-secondary">
          В библиотеке пока ничего нет
        </div>
      ) : (
        <>
          <nav aria-label="Фильтр по типу" className="flex flex-wrap gap-2">
            {tabs.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                aria-current={t.current ? "page" : undefined}
                className={`${tab} ${t.current ? "bg-green-50 text-green-700" : "text-text-secondary hover:bg-surface"}`}
              >
                {t.label}
              </Link>
            ))}
          </nav>
          <LibraryFilters
            filter={{ type: filter.kind, level: filter.level, topic: filter.topic, age: filter.ageGroup, book: filter.textbookId, lesson: filter.lessonId, student: filter.studentId }}
            topics={topics}
            textbooks={textbooks}
            students={students}
          />
          {materials.length === 0 ? (
            <p className="text-text-secondary">Ничего не нашлось</p>
          ) : (
            <ul aria-label="Материалы" className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {materials.map((m) => (
                <li key={m.id} className="flex flex-col gap-2 rounded-card border border-border p-4">
                  <span className="font-semibold">{m.title}</span>
                  <span className="flex flex-wrap gap-2 text-caption text-text-secondary">
                    <span>{MATERIAL_KIND_FILTERS[m.kind]}</span>
                    {m.kind === "game" && m.warmup && <span>{MATERIAL_KIND_FILTERS.warmup}</span>}
                    <span>{m.level}</span>
                    {m.topics.map((topic) => (
                      <span key={topic}>{topic}</span>
                    ))}
                    <span>{AGE_GROUP_LABELS[m.ageGroup]}</span>
                  </span>
                  <Link href={`/teacher/library/${m.id}`} className="self-start text-small text-green-600 hover:text-green-700">
                    Открыть
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
