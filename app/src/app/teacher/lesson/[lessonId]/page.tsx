import { notFound } from "next/navigation";
import { LessonPanelClient as LessonPanel } from "@/components/lesson-mode-client";
import { isNotFound } from "@/server/router";
import { teacherCaller } from "../../caller";

export const metadata = { title: "Пульт урока — StudySoft" };

type Props = { params: Promise<{ lessonId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The lesson mode's control panel (#152): the teacher's only; the stage opens beside it as its own window. */
export default async function LessonPanelPage({ params }: Props) {
  const { lessonId } = await params;
  if (!UUID.test(lessonId)) notFound();
  const { caller } = await teacherCaller();
  let lesson;
  try {
    lesson = await caller.teacher.lessonMode.open({ lessonId });
  } catch (error) {
    if (isNotFound(error)) notFound();
    throw error;
  }
  return (
    <LessonPanel
      lessonId={lesson.lessonId}
      firstName={lesson.firstName}
      durationMinutes={lesson.durationMinutes}
      textbookTitle={lesson.textbookTitle}
      resources={lesson.resources}
      teachersBook={lesson.teachersBook}
      serverKept={lesson.kept}
      serverNote={lesson.note}
    />
  );
}
