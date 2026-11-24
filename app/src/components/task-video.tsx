import type { StudentTaskVideo } from "@/domain/homework-format";
import { YouTubePlayer } from "./youtube-player";

/**
 * The video a homework task is about (#330), above the task: a library
 * video's own file plays here, a YouTube link in its embedded player (#325),
 * any other link opens in a new tab.
 */
export function TaskVideo({ video }: { video: StudentTaskVideo }) {
  if (video.file) {
    return (
      // biome-ignore lint/a11y/useMediaCaption: the teacher's own video has no captions
      <video key={video.file} src={video.file} controls playsInline preload="metadata" aria-label={video.title} className="w-full rounded-task border border-border bg-black" />
    );
  }
  if (video.embed) return <YouTubePlayer src={video.embed} title={video.title} />;
  if (!video.link) return null;
  return (
    <a
      href={video.link}
      target="_blank"
      rel="noopener noreferrer"
      className="flex self-start rounded-task border border-border bg-accent-50 px-4 py-3 text-answer font-semibold text-accent-900"
    >
      Смотреть видео
    </a>
  );
}
