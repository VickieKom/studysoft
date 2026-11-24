// A video in homework (#330), shared by the teacher's draft and the student's
// page: tasks about one video in a row show it once, above the first of them.
// Plain data only.
import type { StudentTaskVideo, Task, TaskVideo } from "./homework-format";
import { youTubeEmbedUrl } from "./library";

/** Whether two tasks are about the same video. */
export function sameVideo(a: TaskVideo | undefined, b: TaskVideo | undefined): boolean {
  if (!a || !b) return false;
  return "library" in a ? "library" in b && a.library === b.library : "url" in b && a.url === b.url;
}

/** Whether the task at `index` is about a video the task before it is not: the video is shown above it. */
export function startsVideo(tasks: Task[], index: number): boolean {
  const video = tasks[index]?.video;
  return video !== undefined && !sameVideo(tasks[index - 1]?.video, video);
}

/** A task's video as it plays: a library video as `library` has it, a YouTube link embedded (#325), another link to open. */
export function playedVideo(video: TaskVideo, library: Record<string, StudentTaskVideo>): StudentTaskVideo | undefined {
  if ("library" in video) return library[video.library];
  const embed = youTubeEmbedUrl(video.url);
  return embed ? { title: "Видео", embed } : { title: "Видео", link: video.url };
}
