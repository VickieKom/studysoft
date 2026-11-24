"use client";

import { useEffect, useState } from "react";
import type { StageVideo } from "@/domain/lesson-state";
import { routerClient } from "./router-client";

/** How often the stage and the panel ask for the student's answers while a video stage is on. */
const VIDEO_POLL_MS = 3000;

/**
 * The video stages' tasks with the student's answers from this lesson
 * (#328): asked while a video stage is current, since the child answers
 * under the video after the lesson has opened.
 */
export function useLessonVideos(lessonId: string, active: boolean): StageVideo[] {
  const [videos, setVideos] = useState<StageVideo[]>([]);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const load = () =>
      routerClient.teacher.lessonMode.videos
        .query({ lessonId })
        .then((found) => {
          if (!stopped) setVideos(found);
        })
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, VIDEO_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [lessonId, active]);
  return videos;
}
