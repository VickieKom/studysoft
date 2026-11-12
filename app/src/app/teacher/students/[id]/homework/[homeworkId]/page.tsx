import Link from "next/link";
import { notFound } from "next/navigation";
import { HomeworkPublish } from "@/components/homework-publish";
import { HomeworkDraftEditor } from "@/components/homework-draft-editor";
import { HomeworkTaskPreview } from "@/components/homework-task-preview";
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

  return (
    <main className="max-w-3xl">
      <p className="mb-4">
        <Link href={`/teacher/students/${student.id}`} className="text-small text-green-600 hover:text-green-700">
          ← {student.firstName}
        </Link>
      </p>
      <header className="mb-6 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-h1 font-bold">{homework.title}</h1>
          <span className="rounded-full bg-green-50 px-2 py-0.5 text-caption text-green-700">
            {HOMEWORK_STATUS_LABELS[homework.status]}
          </span>
        </div>
        <HomeworkPublish homeworkId={homework.id} status={homework.status} dueDate={homework.dueDate} />
      </header>
      {homework.status === "draft" ? (
        <HomeworkDraftEditor homeworkId={homework.id} tasks={homework.tasks} />
      ) : (
        <ol className="flex flex-col gap-4">
          {homework.tasks.map((task, index) => (
            <li key={index} className="rounded-card border border-border p-4">
              <HomeworkTaskPreview task={task} number={index + 1} />
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
