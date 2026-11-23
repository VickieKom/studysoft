// Values shared by the library's screens and its server validation (#115).

/** Material types; textbooks and characters come later (#6, stage 3). */
export const MATERIAL_KINDS = ["game", "warmup", "video"] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];
/** The type filter, plural as the filter reads. */
export const MATERIAL_KIND_FILTERS: Record<MaterialKind, string> = { game: "Игры", warmup: "Разминки", video: "Видео" };

/** Age groups the teacher works with (product vision, section 3). */
export const AGE_GROUPS = ["younger", "teens"] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];
export const AGE_GROUP_LABELS: Record<AgeGroup, string> = { younger: "младшие", teens: "подростки" };

/** A game is one self-contained HTML file, as AI chats save them. */
export const MAX_GAME_BYTES = 5 * 1024 * 1024;
/** A game opened to a student stays open this long after the end of the lesson it was opened in (#118). */
export const GAME_ACCESS_AFTER_LESSON_MS = 60 * 60 * 1000;
/** A warm-up is a picture or a list of conversation questions (#116). */
export const WARMUP_FORMATS = ["picture", "questions"] as const;
export type WarmupFormat = (typeof WARMUP_FORMATS)[number];
export const WARMUP_FORMAT_LABELS: Record<WarmupFormat, string> = { picture: "Картинка", questions: "Вопросы" };
/** A warm-up picture, as a homework picture: PNG, JPEG or WebP up to 2 MB. */
export const MAX_PICTURE_BYTES = 2 * 1024 * 1024;
export const MAX_QUESTIONS = 30;
export const MAX_QUESTION_LENGTH = 300;
/** An own video file (#117): decided by the product owner, with the disk of the stand and staging in mind. */
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
/** The video files a browser plays (#117); other formats are converted by the teacher before uploading. */
export const VIDEO_FILE_ACCEPT = ".mp4,.m4v,.webm,.mov,video/mp4,video/webm,video/quicktime";
export const MAX_URL_LENGTH = 2000;
export const MAX_TITLE_LENGTH = 200;
export const MAX_TOPIC_LENGTH = 100;
/** The most topics one material has (#290). */
export const MAX_TOPICS = 10;

/**
 * The topics typed into «Тема», separated by commas (#290): each trimmed,
 * empty ones dropped, a repeat in another letter case kept once as first
 * typed.
 */
export function parseTopics(text: string): string[] {
  const topics: string[] = [];
  for (const part of text.split(",")) {
    const topic = part.trim().replace(/\s+/g, " ");
    if (topic !== "" && !topics.some((t) => t.toLocaleLowerCase("ru") === topic.toLocaleLowerCase("ru"))) topics.push(topic);
  }
  return topics;
}

/** The topics as the «Тема» field shows them. */
export const topicsText = (topics: string[]) => topics.join(", ");

/**
 * The sandbox a game runs in, framed and when its address is opened (#115).
 * Without allow-same-origin the page gets an opaque origin: no cookies, no
 * storage, no access to the page around it. Forms, dialogs and pointer lock
 * are what self-made games use.
 */
// shortcut: games may load scripts from the network (AI-made games often use a CDN); whether to forbid it is decided with the maintainer (#125)
export const GAME_SANDBOX = "allow-scripts allow-forms allow-modals allow-pointer-lock";

/** Where an embedded YouTube player comes from (#325): the privacy-enhanced host, which sets no cookies until the video plays. */
export const YOUTUBE_EMBED_ORIGIN = "https://www.youtube-nocookie.com";

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);

/**
 * The video's id when a link is a YouTube video (#325): youtube.com/watch?v=,
 * youtu.be/ or youtube.com/shorts/, over https or http. Anything else — a
 * channel, a playlist, another site — is null and stays a link.
 */
export function youTubeId(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.split("/")[1] ?? null;
  else if (YOUTUBE_HOSTS.has(host)) {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else if (url.pathname.startsWith("/shorts/")) id = url.pathname.split("/")[2] ?? null;
  }
  return id && YOUTUBE_ID.test(id) ? id : null;
}

/** The embedded player's address for a YouTube link, or null for any other link. */
export function youTubeEmbedUrl(link: string): string | null {
  const id = youTubeId(link);
  return id ? `${YOUTUBE_EMBED_ORIGIN}/embed/${id}` : null;
}
