"use client";

import { useRouter } from "next/navigation";
import { Button } from "./button";
import { openStageWindow } from "./lesson-panel";

/** «Запустить урок» (#152): the stage opens as its own window, the panel in this tab. */
export function LaunchLesson({ lessonId }: { lessonId: string }) {
  const router = useRouter();
  return (
    <Button
      onClick={() => {
        // Opened in the click itself: a browser blocks a window opened later.
        openStageWindow(lessonId);
        router.push(`/teacher/lesson/${lessonId}`);
      }}
    >
      Запустить урок
    </Button>
  );
}
