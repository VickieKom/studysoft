import { notFound } from "next/navigation";
import { LessonStageClient as LessonStage } from "@/components/lesson-mode-client";
import { isNotFound } from "@/server/router";
import { teacherCaller } from "../../teacher/caller";

// The window's title is what the teacher picks in the video call's list of windows.
export const metadata = { title: "Экран для ученика" };

type Props = { params: Promise<{ lessonId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The lesson mode's stage (#152): the window the teacher shows in the video
 * call. Outside the workspace's layout, so none of the platform's menu is on
 * it; the teacher's session is still required, as for any of her pages.
 */
export default async function LessonStagePage({ params }: Props) {
  const { lessonId } = await params;
  if (!UUID.test(lessonId)) notFound();
  const { caller } = await teacherCaller();
  let stage;
  try {
    stage = await caller.teacher.lessonMode.stage({ lessonId });
  } catch (error) {
    if (isNotFound(error)) notFound();
    throw error;
  }
  return <LessonStage lessonId={stage.lessonId} resources={stage.resources} serverKept={stage.kept} />;
}
