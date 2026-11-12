import Link from "next/link";
import { STATUS_LABELS, STATUSES, type Status, timeZoneLabel } from "@/domain/student";
import { teacherCaller } from "../caller";

export const metadata = { title: "Ученики — StudySoft" };

type Props = { searchParams: Promise<{ status?: string }> };

function parseStatus(value: string | undefined): Status | undefined {
  return STATUSES.find((status) => status === value);
}

const filterClass = "rounded-control px-3 py-1.5 text-small font-semibold";

export default async function StudentsPage({ searchParams }: Props) {
  const status = parseStatus((await searchParams).status);
  const { caller } = await teacherCaller();
  const students = await caller.teacher.students.list(status ? { status } : undefined);

  // "Активные" is everyone except "Завершили", the archive.
  const filters: { label: string; href: string; current: boolean }[] = [
    { label: "Активные", href: "/teacher/students", current: !status },
    ...STATUSES.map((value) => ({
      label: STATUS_LABELS[value],
      href: `/teacher/students?status=${value}`,
      current: status === value,
    })),
  ];

  return (
    <main>
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-h1 font-bold">Ученики</h1>
        <Link
          href="/teacher/students/new"
          className="inline-flex h-10 items-center rounded-control bg-green-600 px-4 text-button font-semibold text-on-accent hover:bg-green-700"
        >
          Новый ученик
        </Link>
      </header>
      <nav aria-label="Статус" className="mb-6 flex flex-wrap gap-2">
        {filters.map((filter) => (
          <Link
            key={filter.href}
            href={filter.href}
            aria-current={filter.current ? "page" : undefined}
            className={`${filterClass} ${filter.current ? "bg-green-50 text-green-700" : "text-text-secondary hover:bg-surface"}`}
          >
            {filter.label}
          </Link>
        ))}
      </nav>
      {students.length === 0 ? (
        <div className="rounded-card border border-border bg-surface px-6 py-12 text-center">
          {status ? (
            <p className="text-h3 font-semibold">Нет учеников с этим статусом</p>
          ) : (
            <>
              <p className="text-h3 font-semibold">Пока нет учеников</p>
              <p className="mt-1 text-text-secondary">Добавьте первого ученика, чтобы выдать ему ссылку и задания</p>
            </>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-card border border-border">
          {students.map((student) => (
            <li key={student.id}>
              <Link href={`/teacher/students/${student.id}`} className="flex items-center gap-4 px-6 py-4 hover:bg-surface">
                <span className="flex-1 font-semibold">
                  {student.firstName}
                  {student.lastName && <span className="font-normal"> {student.lastName}</span>}
                </span>
                <span className="text-small text-text-secondary">{student.level}</span>
                <span className="text-small text-text-secondary">{timeZoneLabel(student.timeZone)}</span>
                <span className="rounded-full bg-green-50 px-2 py-0.5 text-caption text-green-700">
                  {STATUS_LABELS[student.status]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
