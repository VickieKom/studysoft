import Link from "next/link";
import { notFound } from "next/navigation";
import { HomeworkDraft } from "@/components/homework-draft";
import { HomeworkPublish } from "@/components/homework-publish";
import { HomeworkTaskPreview } from "@/components/homework-task-preview";
import { TaskVideo } from "@/components/task-video";
import type { StudentTaskVideo } from "@/domain/homework-format";
import { startsVideo } from "@/domain/homework-video";
import { HOMEWORK_STATUS_LABELS } from "@/domain/homework";
import { isNotFound } from "@/server/router";
import { teacherCaller } from "../../../../caller";
import { studentOrNotFound } from "../../../student";

export const metadata = { title: "Домашка — StudySoft" };

type Props = { params: Promise<{ id: string; homeworkId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The preview for the teacher: the tasks with their keys, to catch a wrong key
 * before publishing. A draft can be edited in place (#37); a published
 * homework is read-only.
 */
export default async function HomeworkPage({ params }: Props) {
  const { id, homeworkId } = await params;
  const student = await studentOrNotFound(id);
  if (!UUID.test(homeworkId)) notFound();
  const { caller } = await teacherCaller();
  let homework;
  try {
    homework = await caller.teacher.homework.get({ id: homeworkId });
  } catch (error) {
    if (isNotFound(error)) notFound();
    throw error;
  }
  if (homework.studentId !== student.id) notFound();
  // The videos the tasks are about (#330), as the student will watch them, and the library's to add.
  const taskVideos = await caller.teacher.homework.taskVideos({ id: homeworkId });
  const addable = homework.status === "draft" ? await caller.teacher.homework.videosToAdd() : [];
  const libraryVideos: Record<string, StudentTaskVideo> = {};
  homework.tasks.forEach((task, index) => {
    const video = taskVideos[index];
    if (task.video && "library" in task.video && video) libraryVideos[task.video.library] = video;
  });
  for (const added of addable) if (added.video) libraryVideos[added.id] = added.video;
  const survey = homework.status === "draft" ? await caller.teacher.homework.survey({ id: homework.id }) : null;

  const heading = (
    <div className="flex items-center gap-3">
      <h1 className="text-h1 font-bold">{homework.title}</h1>
      <span className="rounded-full bg-green-50 px-2 py-0.5 text-caption text-green-700">
        {HOMEWORK_STATUS_LABELS[homework.status]}
      </span>
    </div>
  );

  return (
    <main className="max-w-3xl">
      <p className="mb-4">
        <Link href={`/teacher/students/${student.id}`} className="text-small text-green-600 hover:text-green-700">
          ← {student.firstName}
        </Link>
      </p>
      {homework.status === "draft" ? (
        <HomeworkDraft
          homeworkId={homework.id}
          tasks={homework.tasks}
          revision={homework.revision}
          askFeedback={homework.askFeedback}
          libraryVideos={libraryVideos}
          addableVideos={addable.map(({ id, title }) => ({ id, title }))}
          survey={survey}
        >
          {heading}
        </HomeworkDraft>
      ) : (
        <>
          <header className="mb-6 flex flex-col gap-3">
            {heading}
            <HomeworkPublish
              homeworkId={homework.id}
              status={homework.status}
              dueDate={homework.dueDate}
              revision={homework.revision}
            />
          </header>
          <ol className="flex flex-col gap-4">
            {homework.tasks.map((task, index) => (
              <li key={index} className="flex flex-col gap-3 rounded-card border border-border p-4">
                {startsVideo(homework.tasks, index) && taskVideos[index] && <TaskVideo video={taskVideos[index]} />}
                <HomeworkTaskPreview task={task} number={index + 1} homeworkId={homework.id} />
              </li>
            ))}
          </ol>
        </>
      )}
    </main>
  );
}
