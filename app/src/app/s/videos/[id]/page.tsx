import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerCaller, isNotFound, isUnauthorized } from "@/server/router";

export const metadata = { title: "Видео — StudySoft" };

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A video the teacher opened to the student (#158). An own file plays here,
 * served in byte ranges as for the teacher; the student plays, pauses and
 * seeks it. A link opens in a new tab. A video not open to this student, a
 * closed one, a missing one and no session all end in the same 404 page.
 */
export default async function StudentVideoPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const caller = createServerCaller(await headers());
  let video;
  try {
    video = await caller.student.videos.get({ id });
  } catch (error) {
    if (isNotFound(error) || isUnauthorized(error)) notFound();
    throw error;
  }

  return (
    <main className="flex flex-col gap-4">
      <p>
        <Link href="/s" className="text-small text-accent-900">
          ← На главную
        </Link>
      </p>
      <h1 className="text-task-title font-bold">{video.title}</h1>
      {video.fileUrl ? (
        // biome-ignore lint/a11y/useMediaCaption: the teacher's own video has no captions
        <video src={video.fileUrl} controls playsInline preload="metadata" className="w-full rounded-task border border-border bg-black" />
      ) : video.link ? (
        <a
          href={video.link}
          target="_blank"
          rel="noopener noreferrer"
          className="flex self-start rounded-task border border-border bg-accent-50 px-4 py-3 text-answer font-semibold text-accent-900"
        >
          Смотреть
        </a>
      ) : null}
    </main>
  );
}
