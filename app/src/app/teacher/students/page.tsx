import { Button } from "@/components/button";
import { teacherCaller } from "../caller";

export const metadata = { title: "Ученики — StudySoft" };

export default async function StudentsPage() {
  const { caller } = await teacherCaller();
  const students = await caller.teacher.students.list();

  return (
    <main>
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-h1 font-bold">Ученики</h1>
        {/* Creating a student arrives with #18. */}
        <Button>Новый ученик</Button>
      </header>
      {students.length === 0 ? (
        <div className="rounded-card border border-border bg-surface px-6 py-12 text-center">
          <p className="text-h3 font-semibold">Пока нет учеников</p>
          <p className="mt-1 text-text-secondary">Добавьте первого ученика, чтобы выдать ему ссылку и задания</p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-card border border-border">
          {students.map((student) => (
            <li key={student.id} className="px-6 py-4">
              {student.displayName}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
