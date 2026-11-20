import { headers } from "next/headers";
import { HomeworkResult } from "@/components/homework-result";
import { HomeworkRunner } from "@/components/homework-runner";
import { formatDueDate, tasksLabel } from "@/domain/homework";
import { LinkExchange } from "@/components/link-exchange";
import { StudentGames } from "@/components/student-games";
import { StudentVideos } from "@/components/student-videos";
import { createServerCaller, isNotFound, isUnauthorized } from "@/server/router";

export const metadata = { title: "Домашка — StudySoft" };

export default async function StudentPage() {
  const caller = createServerCaller(await headers());
  let firstName: string;
  try {
    ({ firstName } = await caller.student.me());
  } catch (error) {
    if (isUnauthorized(error)) return <LinkExchange />;
    throw error;
  }
  const homework = await caller.student.homework.current();
  // The games and videos the teacher opened during a lesson (#118, #158) come first, above the homework.
  const games = (
    <>
      <StudentGames games={await caller.student.games.list()} />
      <StudentVideos videos={await caller.student.videos.list()} />
    </>
  );

  if (homework?.result) {
    return (
      <div className="flex flex-col gap-6">
        {games}
        <HomeworkResult firstName={firstName} {...homework.result} />
      </div>
    );
  }

  let opened: Awaited<ReturnType<typeof caller.student.homework.open>> | null = null;
  if (homework) {
    try {
      opened = await caller.student.homework.open({ id: homework.id });
    } catch (error) {
      // Taken back by the teacher between the two calls: no homework.
      if (!isNotFound(error)) throw error;
    }
  }

  if (!homework || !opened) {
    return (
      <main className="flex flex-col gap-6">
        <h1 className="text-task-title font-bold">Привет, {firstName}!</h1>
        {games}
        <div className="rounded-task border border-border bg-accent-50 px-6 py-10 text-center">
          <p className="text-answer font-semibold text-accent-900">Домашних заданий пока нет</p>
        </div>
      </main>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {games}
      <HomeworkRunner
      homeworkId={homework.id}
      firstName={firstName}
      dueLabel={formatDueDate(homework.dueDate)}
      tasksLabel={tasksLabel(homework.taskCount)}
      tasks={opened.tasks}
      answers={opened.answers}
      />
    </div>
  );
}
