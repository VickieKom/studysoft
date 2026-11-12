import Link from "next/link";
import { notFound } from "next/navigation";
import { ReviewStudentFilter } from "@/components/review-student-filter";
import { formatReviewDate } from "@/domain/homework";
import { isNotFound } from "@/server/router";
import { teacherCaller } from "../caller";

export const metadata = { title: "Проверка домашек — StudySoft" };

type Props = { searchParams: Promise<{ student?: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** «Проверка домашек» (#36): current submissions and missed homework, newest first. */
export default async function ReviewListPage({ searchParams }: Props) {
  const requested = (await searchParams).student;
  const studentId = requested && UUID.test(requested) ? requested : null;
  const { caller } = await teacherCaller();
  const students = await caller.teacher.students.list();
  let rows;
  try {
    rows = await caller.teacher.review.list({ studentId });
  } catch (error) {
    if (isNotFound(error)) notFound();
    throw error;
  }

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-h1 font-bold">Проверка домашек</h1>
        <ReviewStudentFilter
          students={students.map((s) => ({ id: s.id, name: [s.firstName, s.lastName].filter(Boolean).join(" ") }))}
          selected={studentId}
        />
      </header>
      {rows.length === 0 ? (
        <p className="text-text-secondary">Сданных домашек пока нет</p>
      ) : (
        <ul className="divide-y divide-border rounded-card border border-border">
          {rows.map((row) => (
            <li key={row.submissionId ?? row.homeworkId} className="flex flex-wrap items-center gap-4 px-4 py-3">
              {row.submissionId ? (
                <Link href={`/teacher/homework-review/${row.submissionId}`} className="flex-1 font-semibold hover:underline">
                  {row.studentName} · {row.title}
                </Link>
              ) : (
                <span className="flex-1 font-semibold">
                  {row.studentName} · {row.title}
                </span>
              )}
              {row.date && <span className="text-small text-text-secondary">{formatReviewDate(row.date)}</span>}
              {row.missed ? (
                <span className="text-small text-text-secondary">Не сдана</span>
              ) : (
                <span className="text-small">
                  {row.correct} верно, {row.wrong} неверно
                </span>
              )}
              {row.waiting && (
                <span className="rounded-full bg-accent-100 px-2 py-0.5 text-caption text-accent-900">ждёт проверки</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
