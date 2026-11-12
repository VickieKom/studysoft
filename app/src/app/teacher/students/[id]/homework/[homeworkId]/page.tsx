import Link from "next/link";
import { notFound } from "next/navigation";
import { HomeworkPublish } from "@/components/homework-publish";
import { answerKey, HOMEWORK_STATUS_LABELS, TASK_TYPE_LABELS } from "@/domain/homework";
import { isNotFound } from "@/server/router";
import { teacherCaller } from "../../../../caller";
import { studentOrNotFound } from "../../../student";

export const metadata = { title: "Домашка — StudySoft" };

type Props = { params: Promise<{ id: string; homeworkId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The preview for the teacher: the tasks with their keys, to catch a wrong key before publishing. */
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
      <ol className="flex flex-col gap-4">
        {homework.tasks.map((task, index) => {
          const key = answerKey(task);
          return (
            <li key={index} className="rounded-card border border-border p-4">
              <p className="text-caption text-text-muted">
                {index + 1}. {TASK_TYPE_LABELS[task.type]}
              </p>
              <p className="mt-1 font-semibold">{task.prompt}</p>
              {"text" in task && <p className="mt-2">{task.text}</p>}
              {"options" in task && task.options && (
                <p className="mt-2 flex flex-wrap gap-2">
                  {task.options.map((option, i) => (
                    <span key={i} className="rounded-control border border-border px-2 py-1 text-small">
                      {option}
                    </span>
                  ))}
                </p>
              )}
              {"hint" in task && task.hint && <p className="mt-2 text-small text-text-secondary">{task.hint}</p>}
              {key !== null && (
                <p className="mt-2 text-small text-green-700">
                  <span className="font-semibold">Ответ:</span> {key}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </main>
  );
}
