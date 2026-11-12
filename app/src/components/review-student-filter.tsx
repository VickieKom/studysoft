"use client";

import { useRouter } from "next/navigation";

/** The «Ученик» filter of «Проверка домашек». */
export function ReviewStudentFilter({
  students,
  selected,
}: {
  students: { id: string; name: string }[];
  selected: string | null;
}) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="review-student" className="text-small text-text-secondary">
        Ученик
      </label>
      <select
        id="review-student"
        value={selected ?? ""}
        onChange={(event) =>
          router.push(event.target.value ? `/teacher/homework-review?student=${event.target.value}` : "/teacher/homework-review")
        }
        className="h-10 rounded-control border border-border bg-bg px-3"
      >
        <option value="">Все ученики</option>
        {students.map((student) => (
          <option key={student.id} value={student.id}>
            {student.name}
          </option>
        ))}
      </select>
    </div>
  );
}
