import Link from "next/link";

type Video = { id: string; title: string; fileUrl: string | null; link: string | null };

const item = "flex rounded-task border border-border bg-accent-50 px-4 py-3 text-answer font-semibold text-accent-900";

/**
 * «Видео» in the student's «Материалы урока» (#158, #241): the videos the teacher opened during
 * a lesson; nothing when there are none. An own file opens its page and plays
 * there; a link opens in a new tab, where the platform does not control it.
 */
export function StudentVideos({ videos }: { videos: Video[] }) {
  if (videos.length === 0) return null;
  return (
    <section aria-labelledby="student-videos" className="flex flex-col gap-3">
      <h2 id="student-videos" className="text-answer font-bold">
        Видео
      </h2>
      <ul className="flex flex-col gap-2">
        {videos.map((video) => (
          <li key={video.id}>
            {video.fileUrl ? (
              <Link href={`/s/videos/${video.id}`} className={item}>
                {video.title}
              </Link>
            ) : video.link ? (
              <a href={video.link} target="_blank" rel="noopener noreferrer" className={item}>
                {video.title}
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
