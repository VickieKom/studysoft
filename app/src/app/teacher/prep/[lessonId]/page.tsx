import Link from "next/link";
import { notFound } from "next/navigation";
import { LaunchLesson } from "@/components/launch-lesson";
import { LessonPlanEditor } from "@/components/lesson-plan-editor";
import { formatPastDate } from "@/domain/homework";
import { dateIn, timeIn } from "@/domain/schedule";
import { isNotFound } from "@/server/router";
import { teacherCaller } from "../../caller";

export const metadata = { title: "Подготовка урока — StudySoft" };

type Props = { params: Promise<{ lessonId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A lesson's preparation (#151): the assistant's draft when there is one,
 * else the approved plan, else the plan proposed — the student's next book
 * lesson — and the homework draft for the lesson.
 */
export default async function LessonPrepPage({ params }: Props) {
  const { lessonId } = await params;
  if (!UUID.test(lessonId)) notFound();
  const { caller } = await teacherCaller();
  let prep;
  let bank;
  try {
    [prep, bank] = await Promise.all([caller.teacher.prep.get({ lessonId }), caller.teacher.prep.bankTasks({ lessonId })]);
  } catch (error) {
    if (isNotFound(error)) notFound();
    throw error;
  }
  const { timeZone } = await caller.teacher.settings.get();
  const moment = new Date(prep.startsAt);

  return (
    <main className="flex max-w-3xl flex-col gap-6">
      <p>
        <Link href="/teacher/prep" className="text-small text-green-600 hover:text-green-700">
          ← Подготовка
        </Link>
      </p>
      <header className="flex flex-col gap-1">
        <h1 className="text-h1 font-bold">Урок: {prep.firstName}</h1>
        <p className="text-text-secondary">
          {formatPastDate(dateIn(moment, timeZone))}, {timeIn(moment, timeZone)} · {prep.durationMinutes} мин
          {prep.textbookTitle && ` · ${prep.textbookTitle}`}
        </p>
        <div className="mt-2">
          <LaunchLesson lessonId={prep.lessonId} />
        </div>
        <p className="text-small">
          {prep.plan ? <span className="text-green-700">подготовлен</span> : <span className="text-text-secondary">не подготовлен</span>}
        </p>
        {prep.requestId ? (
          // An intro lesson (#338): the child's hidden card has no page, the request has.
          <p className="text-small text-text-secondary">
            Вводный урок:{" "}
            <Link href={`/teacher/requests/${prep.requestId}`} className="text-green-600 hover:text-green-700">
              заявка
            </Link>
          </p>
        ) : !prep.textbookTitle && (
          <p className="text-small text-text-secondary">
            Учебник ученика не выбран: выберите его на{" "}
            <Link href={`/teacher/students/${prep.studentId}`} className="text-green-600 hover:text-green-700">
              карточке
            </Link>
            , и подготовка предложит следующий урок
          </p>
        )}
      </header>
      <LessonPlanEditor
        // Kept across the refresh after saving, so «План сохранён» stays; a full reload starts it again from the server.
        key={prep.lessonId}
        lessonId={prep.lessonId}
        start={prep.start}
        fromAssistant={prep.draft !== null}
        revision={prep.revision}
        lessons={prep.lessons}
        materials={prep.materials}
        homeworkDrafts={prep.homeworkDrafts}
        homeworkId={prep.homeworkId}
        waitingHomework={prep.waitingHomework}
        stageHomework={prep.stageHomework}
        bank={bank}
        textbookVideos={prep.textbookVideos}
        openedVideos={prep.openedVideos}
      />
    </main>
  );
}
