import Link from "next/link";
import { AssistantToken } from "@/components/assistant-token";
import { teacherCaller } from "../caller";

export const metadata = { title: "Ассистент — StudySoft" };

export default async function AssistantPage() {
  const { caller } = await teacherCaller();
  const status = await caller.teacher.assistant.status();

  return (
    <main className="max-w-2xl">
      <p className="mb-4">
        <Link href="/teacher/students" className="text-small text-green-600 hover:text-green-700">
          ← Ученики
        </Link>
      </p>
      <h1 className="mb-2 text-h1 font-bold">Ассистент</h1>
      <p className="mb-6 text-text-secondary">
        Ассистент на вашем компьютере читает контекст ученика — уровень, юнит, интересы, пробелы, последние заметки —
        и готовит черновики. Фамилии, контакты и ссылки ему не передаются. Публикуете всегда вы.
      </p>
      <AssistantToken status={status} />
    </main>
  );
}
