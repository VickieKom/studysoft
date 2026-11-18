import Link from "next/link";
import { teacherCaller } from "../../caller";

export const metadata = { title: "Учебники — StudySoft" };

/** «Учебники» in «Библиотека» (#156): the teacher's textbook sets. */
export default async function TextbooksPage() {
  const { caller } = await teacherCaller();
  const textbooks = await caller.teacher.textbooks.list();
  return (
    <main className="flex flex-col gap-6">
      <p>
        <Link href="/teacher/library" className="text-small text-green-600 hover:text-green-700">
          ← Библиотека
        </Link>
      </p>
      <header className="flex items-center justify-between">
        <h1 className="text-h1 font-bold">Учебники</h1>
        <Link
          href="/teacher/library/textbooks/new"
          className="inline-flex h-10 items-center rounded-control bg-green-600 px-4 text-button font-semibold text-on-accent hover:bg-green-700"
        >
          Загрузить учебник
        </Link>
      </header>
      {textbooks.length === 0 ? (
        <div className="rounded-card border border-border bg-surface px-6 py-12 text-center text-text-secondary">Учебников пока нет</div>
      ) : (
        <ul aria-label="Учебники" className="flex flex-col gap-2">
          {textbooks.map((t) => (
            <li key={t.id}>
              <Link href={`/teacher/library/textbooks/${t.id}`} className="flex gap-3 rounded-card border border-border p-4 hover:bg-surface">
                <span className="font-semibold">{t.title}</span>
                <span className="text-text-secondary">{t.level}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
