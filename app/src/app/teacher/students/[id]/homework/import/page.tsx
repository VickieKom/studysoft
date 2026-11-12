import Link from "next/link";
import { HomeworkImportForm } from "@/components/homework-import-form";
import { studentOrNotFound } from "../../../student";

export const metadata = { title: "Импорт домашки — StudySoft" };

type Props = { params: Promise<{ id: string }> };

export default async function HomeworkImportPage({ params }: Props) {
  const student = await studentOrNotFound((await params).id);
  return (
    <main className="max-w-3xl">
      <p className="mb-4">
        <Link href={`/teacher/students/${student.id}`} className="text-small text-green-600 hover:text-green-700">
          ← {student.firstName}
        </Link>
      </p>
      <h1 className="mb-2 text-h1 font-bold">Импорт домашки</h1>
      <p className="mb-6 text-text-secondary">
        Вставьте домашку в формате платформы (docs/homework-format.md). Она сохранится черновиком: ученик её не увидит,
        пока вы не опубликуете.
      </p>
      <HomeworkImportForm studentId={student.id} />
    </main>
  );
}
