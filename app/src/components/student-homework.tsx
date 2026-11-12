import Link from "next/link";
import { formatDueDate, HOMEWORK_STATUS_LABELS, tasksLabel } from "@/domain/homework";

type Homework = {
  id: string;
  title: string;
  status: "draft" | "published" | "submitted" | "missed";
  dueDate: string | null;
  taskCount: number;
};

/** The homework section of the student card (#32). */
export function StudentHomework({ studentId, homework }: { studentId: string; homework: Homework[] }) {
  return (
    <section aria-labelledby="homework-heading" className="mt-6 rounded-card border border-border p-6">
      <header className="mb-4 flex items-center justify-between">
        <h2 id="homework-heading" className="text-h3 font-semibold">
          Домашки
        </h2>
        <Link
          href={`/teacher/students/${studentId}/homework/import`}
          className="inline-flex h-10 items-center rounded-control border border-border px-4 text-button font-semibold hover:bg-surface"
        >
          Импортировать домашку
        </Link>
      </header>
      {homework.length === 0 ? (
        <p className="text-text-secondary">Домашек пока нет</p>
      ) : (
        <ul className="divide-y divide-border">
          {homework.map((item) => (
            <li key={item.id} className="py-3">
              <Link href={`/teacher/students/${studentId}/homework/${item.id}`} className="flex items-center gap-4">
                <span className="flex-1 font-semibold">{item.title}</span>
                <span className="text-small text-text-secondary">{tasksLabel(item.taskCount)}</span>
                {item.dueDate && <span className="text-small text-text-secondary">к {formatDueDate(item.dueDate)}</span>}
                <span className="rounded-full bg-green-50 px-2 py-0.5 text-caption text-green-700">
                  {HOMEWORK_STATUS_LABELS[item.status]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
