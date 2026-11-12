import Link from "next/link";
import type { ReactNode } from "react";
import { teacherCaller } from "./caller";

const item = "rounded-control px-3 py-1.5 text-small font-semibold text-text-secondary hover:bg-surface hover:text-text";

// The whole workspace requires a teacher session; without one, sign in first.
export default async function TeacherLayout({ children }: { children: ReactNode }) {
  const { caller } = await teacherCaller();
  // Submissions waiting for the teacher (#36); the number is fresh on every full page load.
  const waiting = await caller.teacher.review.waiting();
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-8 py-10">
      <nav aria-label="Разделы" className="mb-8 flex flex-wrap gap-2 border-b border-border pb-3">
        <Link href="/teacher/students" className={item}>
          Ученики
        </Link>
        <Link href="/teacher/homework-review" className={`${item} inline-flex items-center gap-2`}>
          Проверка домашек
          {waiting > 0 && (
            <span className="rounded-full bg-accent-600 px-2 text-caption text-on-accent">{waiting}</span>
          )}
        </Link>
        <Link href="/teacher/assistant" className={item}>
          Ассистент
        </Link>
      </nav>
      {children}
    </div>
  );
}
