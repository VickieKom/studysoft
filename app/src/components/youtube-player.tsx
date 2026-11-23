/**
 * A YouTube video in an embedded player (#325), from youtube-nocookie.com,
 * the one frame source the page's content security policy allows besides the
 * platform. The player needs the page's origin as its referrer to play.
 */
export function YouTubePlayer({ src, title }: { src: string; title: string }) {
  return (
    <iframe
      src={src}
      title={title}
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
      className="aspect-video w-full rounded-task border border-border bg-black"
    />
  );
}
