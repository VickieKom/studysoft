import { headers } from "next/headers";
import { LinkExchange } from "@/components/link-exchange";
import { StudentAssessmentList } from "@/components/student-assessment-list";
import { StudentGames } from "@/components/student-games";
import { StudentNav } from "@/components/student-nav";
import { StudentVideos } from "@/components/student-videos";
import { createServerCaller, isUnauthorized } from "@/server/router";

export const metadata = { title: "Материалы урока — StudySoft" };

/**
 * «Материалы урока» (#241): the assessment (#253), the games and the videos
 * the teacher opened to the student in a lesson (#118, #158), while they are
 * open.
 */
export default async function StudentMaterialsPage() {
  const caller = createServerCaller(await headers());
  try {
    await caller.student.me();
  } catch (error) {
    if (isUnauthorized(error)) return <LinkExchange />;
    throw error;
  }
  const [games, videos, assessments] = await Promise.all([caller.student.games.list(), caller.student.videos.list(), caller.student.assessments.list()]);
  const open = games.length + videos.length + assessments.length > 0;

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-task-title font-bold">Материалы урока</h1>
      {open ? (
        <>
          <StudentAssessmentList assessments={assessments} />
          <StudentGames games={games} />
          <StudentVideos videos={videos} />
        </>
      ) : (
        <div className="rounded-task border border-border bg-accent-50 px-6 py-10 text-center">
          <p className="text-answer font-semibold text-accent-900">С урока пока ничего нет</p>
          <p className="mt-2 text-small text-accent-900">Здесь появятся игры и видео, которые учитель откроет на уроке</p>
        </div>
      )}
      <StudentNav current="materials" lessonOpen={open} />
    </main>
  );
}
