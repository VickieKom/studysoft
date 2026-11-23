"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import {
  AGE_GROUP_LABELS,
  AGE_GROUPS,
  type AgeGroup,
  MAX_GAME_BYTES,
  MAX_PICTURE_BYTES,
  MAX_TOPIC_LENGTH,
  MAX_TOPICS,
  MAX_TRANSCRIPT_LENGTH,
  MAX_URL_LENGTH,
  MAX_VIDEO_BYTES,
  type MaterialKind,
  VIDEO_FILE_ACCEPT,
  WARMUP_FORMAT_LABELS,
  WARMUP_FORMATS,
  type WarmupFormat,
} from "@/domain/library";
import { LEVELS, type Level } from "@/domain/student";
import { Button } from "./button";
import { routerClient } from "./router-client";

const field = "h-10 rounded-control border border-border bg-bg px-3";

function Labelled({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-small text-text-secondary">
        {label}
      </label>
      {children}
    </div>
  );
}

type Tags = { title: string; level: Level; topic: string; ageGroup: AgeGroup };
type Kind = "game" | "warmup" | "video";
type VideoSource = "link" | "file";

/** A refusal written for the teacher, from the upload address or a procedure. */
class Refused extends Error {}

export type EditedMaterial = Tags & {
  id: string;
  kind: MaterialKind;
  warmup: boolean;
  vocabulary: boolean;
  /** A game's textbook lesson (#291). */
  textbookLesson: { textbookId: string; lessonId: string } | null;
  /** The students a game is made for (#292). */
  students: { id: string; name: string }[];
  questions: string[] | null;
  /** A video's «Расшифровка» (#326). */
  transcript: string | null;
};
type LinkableTextbook = { id: string; title: string; lessons: { id: string; label: string }[] };

/** The questions as typed: one per line; the server trims them and drops empty lines. */
const toQuestions = (text: string) => text.split("\n");

/** A file's bytes as base64, for the router. */
async function base64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * Sends an own video's file to the upload address as it is read from disk
 * (#117) and returns its id; the server refuses a file over 200 MB or of
 * another format with a message.
 */
async function uploadVideo(file: File): Promise<string> {
  const response = await fetch("/api/files/library", {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  const body = (await response.json().catch(() => null)) as { file?: string; error?: string } | null;
  if (response.ok && body?.file) return body.file;
  throw body?.error ? new Refused(body.error) : new Error(`upload failed: ${response.status}`);
}

/**
 * «Загрузить» and «Изменить» in «Библиотека» (#115, #116, #117): a game's
 * file, a warm-up — a picture or a list of questions — or a video — a link or
 * an own file — with a title and tags. A new material goes to the list of its
 * type; an edited one back to its page.
 */
export function LibraryMaterialForm({ material }: { material?: EditedMaterial }) {
  const router = useRouter();
  const [tags, setTags] = useState<Tags>(
    material
      ? { title: material.title, level: material.level, topic: material.topic, ageGroup: material.ageGroup }
      : { title: "", level: "A1", topic: "", ageGroup: "younger" },
  );
  const [kind, setKind] = useState<Kind>("game");
  const [format, setFormat] = useState<WarmupFormat>("picture");
  const [source, setSource] = useState<VideoSource>("link");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [questions, setQuestions] = useState((material?.questions ?? []).join("\n"));
  const [transcript, setTranscript] = useState(material?.transcript ?? "");
  const [warmup, setWarmup] = useState(material?.warmup ?? false);
  // A game template (#282): the platform sends it a student's words.
  const [vocabulary, setVocabulary] = useState(material?.vocabulary ?? false);
  // A game's textbook lesson (#291): her textbooks with a confirmed structure, loaded with the form.
  const [textbooks, setTextbooks] = useState<LinkableTextbook[]>([]);
  const [book, setBook] = useState(material?.textbookLesson?.textbookId ?? "");
  const [lesson, setLesson] = useState(material?.textbookLesson?.lessonId ?? "");
  // The students a game is made for (#292): her active students, and those already marked even if archived since.
  const [students, setStudents] = useState<{ id: string; name: string }[]>(material?.students ?? []);
  const [marked, setMarked] = useState<Set<string>>(new Set((material?.students ?? []).map((s) => s.id)));
  useEffect(() => {
    routerClient.teacher.library.textbooks.query().then(setTextbooks, () => setTextbooks([]));
    routerClient.teacher.students.list.query().then(
      (active) =>
        setStudents((known) => [
          ...active.map((s) => ({ id: s.id, name: s.lastName ? `${s.firstName} ${s.lastName}` : s.firstName })),
          ...known.filter((k) => !active.some((s) => s.id === k.id)),
        ]),
      () => undefined,
    );
  }, []);
  const isGame = material ? material.kind === "game" : kind === "game";
  const link = { textbookId: book || null, textbookLessonId: book ? lesson || null : null };
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const set = (next: Partial<Tags>) => setTags((current) => ({ ...current, ...next }));
  const editsQuestions = material ? material.questions !== null : kind === "warmup" && format === "questions";

  function tooBig(): string | null {
    if (material || !file) return null;
    if (kind === "game" && file.size > MAX_GAME_BYTES) return "Файл больше 5 МБ";
    if (kind === "warmup" && format === "picture" && file.size > MAX_PICTURE_BYTES) return "Картинка больше 2 МБ";
    if (kind === "video" && source === "file" && file.size > MAX_VIDEO_BYTES) return "Файл больше 200 МБ";
    return null;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    const sizeError = tooBig();
    if (sizeError) return setError(sizeError);
    setPending(true);
    try {
      if (material) {
        await routerClient.teacher.library.update.mutate({
          id: material.id,
          ...tags,
          ...(material.kind === "game" ? { warmup, vocabulary, ...link, studentIds: [...marked] } : {}),
          ...(material.questions !== null ? { questions: toQuestions(questions) } : {}),
          ...(material.kind === "video" ? { transcript } : {}),
        });
        router.push(`/teacher/library/${material.id}`);
      } else if (kind === "game") {
        if (!file) throw new Error("no file");
        await routerClient.teacher.library.addGame.mutate({ ...tags, html: await file.text(), vocabulary, ...link, studentIds: [...marked] });
        router.push("/teacher/library?type=game");
      } else if (kind === "video" && source === "link") {
        await routerClient.teacher.library.addVideoLink.mutate({ ...tags, url, transcript });
        router.push("/teacher/library?type=video");
      } else if (kind === "video") {
        if (!file) throw new Error("no file");
        setUploading(true);
        const uploaded = await uploadVideo(file);
        await routerClient.teacher.library.addVideoFile.mutate({ ...tags, file: uploaded, transcript });
        router.push("/teacher/library?type=video");
      } else {
        if (format === "questions") {
          await routerClient.teacher.library.addWarmup.mutate({ ...tags, format, questions: toQuestions(questions) });
        } else {
          if (!file) throw new Error("no file");
          await routerClient.teacher.library.addWarmup.mutate({ ...tags, format, picture: await base64(file) });
        }
        router.push("/teacher/library?type=warmup");
      }
      router.refresh();
    } catch (caught) {
      const message = (caught as { message?: string })?.message;
      const isOwn = caught instanceof Refused || (caught as { data?: { code?: string } })?.data?.code === "BAD_REQUEST";
      setError(isOwn && message ? message : "Не получилось сохранить. Попробуйте ещё раз");
      setUploading(false);
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-4">
      {!material && (
        <>
          <Labelled id="material-kind" label="Тип материала">
            <select
              id="material-kind"
              className={field}
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as Kind);
                setFile(null);
              }}
            >
              <option value="game">Игра</option>
              <option value="warmup">Разминка</option>
              <option value="video">Видео</option>
            </select>
          </Labelled>
          {kind === "warmup" && (
            <Labelled id="material-format" label="Формат разминки">
              <select
                id="material-format"
                className={field}
                value={format}
                onChange={(event) => {
                  setFormat(event.target.value as WarmupFormat);
                  setFile(null);
                }}
              >
                {WARMUP_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {WARMUP_FORMAT_LABELS[f]}
                  </option>
                ))}
              </select>
            </Labelled>
          )}
          {kind === "game" && (
            <Labelled id="material-file" label="Файл игры">
              <input
                key="game"
                id="material-file"
                type="file"
                required
                accept=".html,.htm,text/html"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </Labelled>
          )}
          {kind === "warmup" && format === "picture" && (
            <Labelled id="material-picture" label="Файл картинки">
              <input
                key="picture"
                id="material-picture"
                type="file"
                required
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </Labelled>
          )}
          {kind === "video" && (
            <Labelled id="material-video-source" label="Источник видео">
              <select
                id="material-video-source"
                className={field}
                value={source}
                onChange={(event) => {
                  setSource(event.target.value as VideoSource);
                  setFile(null);
                }}
              >
                <option value="link">Ссылка</option>
                <option value="file">Файл</option>
              </select>
            </Labelled>
          )}
          {kind === "video" && source === "link" && (
            <Labelled id="material-url" label="Ссылка на видео">
              <input
                id="material-url"
                type="url"
                required
                maxLength={MAX_URL_LENGTH}
                placeholder="https://"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                className={field}
              />
            </Labelled>
          )}
          {kind === "video" && source === "file" && (
            <Labelled id="material-video-file" label="Файл видео">
              <input
                key="video"
                id="material-video-file"
                type="file"
                required
                accept={VIDEO_FILE_ACCEPT}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <span className="text-caption text-text-secondary">MP4, WebM или MOV, до 200 МБ</span>
            </Labelled>
          )}
        </>
      )}
      {(material ? material.kind === "video" : kind === "video") && (
        <Labelled id="material-transcript" label="Расшифровка">
          <textarea
            id="material-transcript"
            rows={6}
            maxLength={MAX_TRANSCRIPT_LENGTH}
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
            placeholder="Текст видео: по нему ассистент составит задания"
            className="rounded-control border border-border bg-bg px-3 py-2"
          />
        </Labelled>
      )}
      {editsQuestions && (
        <Labelled id="material-questions" label="Вопросы">
          <textarea
            id="material-questions"
            required
            rows={8}
            value={questions}
            onChange={(event) => setQuestions(event.target.value)}
            placeholder="По одному вопросу в строке"
            className="rounded-control border border-border bg-bg px-3 py-2"
          />
        </Labelled>
      )}
      <Labelled id="material-title" label="Название">
        <input
          id="material-title"
          required
          maxLength={200}
          value={tags.title}
          onChange={(event) => set({ title: event.target.value })}
          className={field}
        />
      </Labelled>
      <Labelled id="material-level" label="Уровень">
        <select
          id="material-level"
          value={tags.level}
          onChange={(event) => set({ level: event.target.value as Level })}
          className={field}
        >
          {LEVELS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </Labelled>
      <Labelled id="material-topic" label="Тема">
        <input
          id="material-topic"
          maxLength={MAX_TOPICS * (MAX_TOPIC_LENGTH + 2)}
          value={tags.topic}
          onChange={(event) => set({ topic: event.target.value })}
          aria-describedby="material-topic-hint"
          className={field}
        />
        <p id="material-topic-hint" className="text-small text-text-secondary">
          Несколько тем — через запятую
        </p>
      </Labelled>
      <Labelled id="material-age" label="Возраст">
        <select
          id="material-age"
          value={tags.ageGroup}
          onChange={(event) => set({ ageGroup: event.target.value as AgeGroup })}
          className={field}
        >
          {AGE_GROUPS.map((age) => (
            <option key={age} value={age}>
              {AGE_GROUP_LABELS[age]}
            </option>
          ))}
        </select>
      </Labelled>
      {material?.kind === "game" && (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={warmup} onChange={(event) => setWarmup(event.target.checked)} />
          Подходит как разминка
        </label>
      )}
      {isGame && textbooks.length > 0 && (
        <>
          <Labelled id="material-textbook" label="Учебник">
            <select
              id="material-textbook"
              value={book}
              onChange={(event) => {
                setBook(event.target.value);
                setLesson("");
              }}
              className={field}
            >
              <option value="">Без учебника</option>
              {textbooks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </Labelled>
          {book && (
            <Labelled id="material-lesson" label="Урок">
              <select id="material-lesson" value={lesson} onChange={(event) => setLesson(event.target.value)} className={field}>
                <option value="">выберите урок</option>
                {(textbooks.find((t) => t.id === book)?.lessons ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </Labelled>
          )}
        </>
      )}
      {isGame && students.length > 0 && (
        <fieldset aria-label="Для учеников" className="flex flex-col gap-1">
          <legend className="text-small text-text-secondary">Для учеников</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {students.map((s) => (
              <label key={s.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={marked.has(s.id)}
                  onChange={() =>
                    setMarked((current) => {
                      const next = new Set(current);
                      if (next.has(s.id)) next.delete(s.id);
                      else next.add(s.id);
                      return next;
                    })
                  }
                />
                {s.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {isGame && (
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={vocabulary} onChange={(event) => setVocabulary(event.target.checked)} />
            Со словами словаря
          </label>
          <p className="text-small text-text-secondary">Игра получит слова ученика: на уроке — того, с кем урок</p>
        </div>
      )}
      {uploading && (
        <p role="status" className="text-small text-text-secondary">
          Загружаем видео…
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          Сохранить
        </Button>
      </div>
    </form>
  );
}
