import { headers } from "next/headers";
import { LinkExchange } from "@/components/link-exchange";
import { StudentNav } from "@/components/student-nav";
import { StudentWords } from "@/components/student-words";
import { createServerCaller, isUnauthorized } from "@/server/router";

export const metadata = { title: "Тренировка слов — StudySoft" };

/** «Тренировка слов» (#236): the student's words, searched and heard. The training itself comes with #238. */
export default async function StudentWordsPage() {
  const caller = createServerCaller(await headers());
  try {
    await caller.student.me();
  } catch (error) {
    if (isUnauthorized(error)) return <LinkExchange />;
    throw error;
  }
  const [words, games, videos] = await Promise.all([caller.student.vocabulary.words(), caller.student.games.list(), caller.student.videos.list()]);

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-task-title font-bold">Тренировка слов</h1>
      <StudentWords words={words} />
      <StudentNav current="words" lessonOpen={games.length + videos.length > 0} />
    </main>
  );
}
