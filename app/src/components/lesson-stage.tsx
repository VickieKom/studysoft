"use client";

import { useEffect, useRef, useState } from "react";
import { looksLikeGameResult } from "@/domain/game-result-format";
import { GAME_SANDBOX } from "@/domain/library";
import {
  bookStageLabel,
  type HomeworkStage,
  homeworkStageLabel,
  isMistake,
  type KeptState,
  type LessonMessage,
  lessonChannel,
  lessonMessageSchema,
  lessonStorageKey,
  keptStateSchema,
  newer,
  pageIn,
  pageLabel,
  shownPages,
  type StageHomework,
  stageKey,
  visibleTasks,
} from "@/domain/lesson-state";
import type { Board } from "@/domain/board";
import { LessonBoard } from "./lesson-board";
import type { LessonResourcesView } from "./lesson-panel";
import { useGameWords } from "./game-words";
import { routerClient } from "./router-client";

/** The stage says it is there this often, and asks for the state when it opens. */
const HELLO_MS = 2000;

function readLocal(lessonId: string): KeptState | null {
  try {
    const parsed = keptStateSchema.safeParse(JSON.parse(window.localStorage.getItem(lessonStorageKey(lessonId)) ?? "null"));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function Tick() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 fill-none stroke-current stroke-2">
      <path d="M3 8.5l3 3 7-7" />
    </svg>
  );
}

/**
 * The stage of the lesson mode (#152): the window the teacher shows in the
 * video call, so everything here is seen by the student. Only lesson
 * content — the stages as tabs, the warm-up, the game (#199), the book's pages, the track,
 * the homework under review (#153) —
 * never the plan's minutes, the note or the platform's menu. It follows the
 * panel over BroadcastChannel; opened again, it starts from the state this
 * browser kept, or the server's — so it is rendered in the browser alone
 * (lesson-mode-client.tsx).
 */
export function LessonStage({ lessonId, resources, serverKept }: { lessonId: string; resources: LessonResourcesView; serverKept: KeptState }) {
  // Opened again, the stage starts where this browser left it, unless the server's is newer.
  const [kept, setKept] = useState<KeptState>(() => newer(serverKept, readLocal(lessonId))!);
  const [soundOn, setSoundOn] = useState(false);
  const [finished, setFinished] = useState(false);
  // The board as the teacher just drew it, until the panel's state carries it back (#155).
  const [drawn, setDrawn] = useState<Board | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const ch = new BroadcastChannel(lessonChannel(lessonId));
    channel.current = ch;
    ch.onmessage = (event: MessageEvent) => {
      const message = lessonMessageSchema.safeParse(event.data);
      if (message.success && message.data.type === "state") {
        const incoming = message.data.kept;
        setKept((k) => (incoming.revision >= k.revision ? incoming : k));
        // The panel has kept the board as last drawn: it is the state's again.
        setDrawn((d) => (d && JSON.stringify(d) === JSON.stringify(incoming.state.board) ? null : d));
      } else if (message.success && message.data.type === "finished") setFinished(true);
    };
    const hello = () => ch.postMessage({ type: "hello" } satisfies LessonMessage);
    hello();
    const timer = setInterval(hello, HELLO_MS);
    return () => {
      clearInterval(timer);
      ch.close();
      channel.current = null;
    };
  }, [lessonId]);

  const { state } = kept;
  const track = state.track;
  const trackUrl = track ? resources.tracks.find((t) => t.name === track.name)?.url : undefined;

  // The track follows the panel. A browser lets a new window play sound only after a click in it.
  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    if (!track?.playing || !trackUrl) {
      element.pause();
      return;
    }
    if (!element.src.endsWith(trackUrl)) element.src = trackUrl;
    element.currentTime = 0;
    element.play().then(
      () => channel.current?.postMessage({ type: "sound", status: "on" } satisfies LessonMessage),
      () => channel.current?.postMessage({ type: "sound", status: "blocked" } satisfies LessonMessage),
    );
  }, [track?.playing, track?.run, trackUrl]);

  function turnSoundOn() {
    setSoundOn(true);
    channel.current?.postMessage({ type: "sound", status: "on" } satisfies LessonMessage);
    if (track?.playing && audio.current) void audio.current.play().catch(() => undefined);
  }

  const current = state.stages[state.current];

  // «Завершить урок» on the panel (#154): nothing of the lesson stays on the screen.
  if (finished) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface p-4">
        <p className="text-h1 font-bold">Урок завершён</p>
      </div>
    );
  }
  const lessonOf = (id: string) => resources.lessons.find((l) => l.id === id);
  const materialOf = (id: string) => resources.materials.find((m) => m.id === id);
  const homeworkOf = (id: string) => resources.homework.find((h) => h.id === id);

  return (
    <div className="flex h-screen gap-4 bg-surface p-4">
      <main className={`${state.boardLarge ? "hidden" : "flex"} min-w-0 flex-1 flex-col gap-3 overflow-hidden rounded-card border border-border bg-bg p-4`}>
        <div role="tablist" aria-label="Этапы урока" className="flex flex-wrap gap-2">
          {state.stages.map((stage, i) => (
            <span
              key={`${i}-${stageKey(stage)}`}
              role="tab"
              aria-selected={i === state.current}
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-small font-semibold ${
                i === state.current ? "bg-green-600 text-on-accent" : stage.done ? "bg-green-50 text-green-700" : "bg-surface text-text-secondary"
              }`}
            >
              {stage.done && i !== state.current && <Tick />}
              {stage.type === "book"
                ? bookStageLabel(lessonOf(stage.lessonId))
                : stage.type === "homework"
                  ? homeworkStageLabel(homeworkOf(stage.homeworkId))
                  : (materialOf(stage.materialId)?.title ?? "")}
            </span>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {current?.type === "book" &&
            (() => {
              const lesson = lessonOf(current.lessonId);
              const book = resources.books.find((b) => b.kind === current.kind && b.pageCount > 0);
              if (!book) return null;
              const pages = shownPages(Math.min(pageIn(current, lesson, current.kind), book.pageCount), state.layout, book.pageCount);
              return (
                <div className="flex h-full items-start justify-center gap-2">
                  {pages.map((p) => (
                    // eslint-disable-next-line @next/next/no-img-element -- served with a permission check, not by the image optimizer
                    <img
                      key={p}
                      src={`/api/files/textbooks/${book.fileId}/pages/${p}`}
                      alt={pageLabel(current.kind, p)}
                      className="h-full max-h-[calc(100vh-7rem)] w-auto rounded-control border border-border object-contain"
                    />
                  ))}
                </div>
              );
            })()}
          {current?.type === "homework" && <HomeworkReview stage={current} homework={homeworkOf(current.homeworkId)} />}
          {current?.type === "material" &&
            (() => {
              const material = materialOf(current.materialId);
              if (!material) return null;
              if (material.kind === "game") {
                return (
                  <StageGame
                    key={material.id}
                    lessonId={lessonId}
                    materialId={material.id}
                    title={material.title}
                    onResult={(kept) => channel.current?.postMessage({ type: "game-result", kept } satisfies LessonMessage)}
                  />
                );
              }
              if (material.kind !== "warmup") return <p className="p-6 text-h2 font-semibold">{material.title}</p>;
              return (
                <div className="flex h-full flex-col items-center justify-center gap-6 p-6">
                  {material.picture && (
                    // eslint-disable-next-line @next/next/no-img-element -- served with a permission check, not by the image optimizer
                    <img src={material.picture} alt={material.title} className="max-h-[70vh] rounded-card object-contain" />
                  )}
                  {material.questions.length > 0 && (
                    <ol className="flex flex-col gap-4 text-h2">
                      {material.questions.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ol>
                  )}
                </div>
              );
            })()}
        </div>
      </main>

      <LessonBoard
        large={state.boardLarge}
        board={drawn ?? state.board}
        onChange={(board) => {
          setDrawn(board);
          channel.current?.postMessage({ type: "board", board } satisfies LessonMessage);
        }}
      />

      {/* biome-ignore lint/a11y/useMediaCaption: a textbook's listening track has no captions; its text is on the page */}
      <audio ref={audio} preload="auto" className="hidden" />
      {!soundOn && (
        <button
          type="button"
          onClick={turnSoundOn}
          className="fixed right-6 bottom-6 rounded-control bg-green-600 px-4 py-2 text-button font-semibold text-on-accent shadow"
        >
          Включить звук
        </button>
      )}
    </div>
  );
}

const verdictText = (verdict: boolean | null) => (verdict === null ? "Ждёт проверки" : verdict ? "Верно" : "Неверно");
const verdictClass = (verdict: boolean | null) => (verdict === null ? "text-text-secondary" : verdict ? "text-green-700" : "text-danger");

/**
 * The homework under review (#153): the score and the child's answers,
 * mistakes highlighted, open answers with the teacher's marks, recordings that
 * play. A task's right answer appears only once the teacher shows it from the
 * panel; the filter is hers too.
 */
function HomeworkReview({ stage, homework }: { stage: HomeworkStage; homework: StageHomework | undefined }) {
  if (!homework) return null;
  const tasks = visibleTasks(stage, homework);
  return (
    <section aria-label="Домашка" className="flex flex-col gap-4 p-2">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-h2 font-semibold">{homework.title}</h2>
        <p className="text-h3 font-semibold">
          {homework.correct} верно, {homework.wrong} неверно
        </p>
      </header>
      {tasks.length === 0 && <p className="text-h3 text-green-700">Ошибок нет</p>}
      <ol className="flex flex-col gap-3">
        {tasks.map((task) => {
          const shown = stage.shown.includes(task.index);
          return (
            <li
              key={task.index}
              className={`flex flex-col gap-2 rounded-card border-2 p-4 text-h3 ${isMistake(task) ? "border-danger bg-danger-bg" : "border-border"}`}
            >
              <p className="font-semibold">
                {task.index + 1}. {task.prompt}
              </p>
              {task.passage && <p className="whitespace-pre-line text-body text-text-secondary">{task.passage}</p>}
              {task.sentences ? (
                <ol className="flex flex-col gap-1">
                  {task.sentences.map((sentence, i) => (
                    <li key={i} className="flex flex-wrap gap-x-3">
                      <span>{sentence.answer ?? "Без ответа"}</span>
                      <span className={verdictClass(sentence.verdict)}>{verdictText(sentence.verdict)}</span>
                      {shown && !sentence.verdict && <span className="text-green-700">Правильный ответ: {sentence.key}</span>}
                    </li>
                  ))}
                </ol>
              ) : (
                <>
                  {task.answer !== null && <p>{task.answer}</p>}
                  {task.answer === null && !task.file && <p className="text-text-secondary">Без ответа</p>}
                  {task.file?.kind === "audio" && (
                    // biome-ignore lint/a11y/useMediaCaption: the child's own recording has no captions
                    <audio controls preload="none" src={task.file.url} className="w-full max-w-md" />
                  )}
                  {task.file?.kind === "image" && (
                    // eslint-disable-next-line @next/next/no-img-element -- served with a permission check, not by the image optimizer
                    <img src={task.file.url} alt={`Фото ответа к заданию ${task.index + 1}`} className="max-h-80 w-auto rounded-control object-contain" />
                  )}
                  <p className={`font-semibold ${verdictClass(task.verdict)}`}>{verdictText(task.verdict)}</p>
                  {shown && task.key !== null && <p className="text-green-700">Правильный ответ: {task.key}</p>}
                </>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * A game of the plan on the stage (#199), in the same sandboxed frame as on
 * the teacher's page: scripts run in an origin of their own, without the
 * platform's cookies or storage. The teacher plays it here; a result it posts
 * in the game result format goes to the lesson's student, one after another,
 * and the panel is told whether it was kept — the stage shows nothing of it.
 */
function StageGame({
  lessonId,
  materialId,
  title,
  onResult,
}: {
  lessonId: string;
  materialId: string;
  title: string;
  onResult: (kept: boolean) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  // A game template gets the lesson's student's words (#282); for any other game the server says not found and nothing is sent.
  useGameWords(frame, { kind: "stage", lessonId, materialId });
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow || !looksLikeGameResult(event.data)) return;
      const result: unknown = event.data;
      queue.current = queue.current.then(() =>
        routerClient.teacher.lessonMode.saveGameResult.mutate({ lessonId, materialId, result }).then(
          () => onResult(true),
          () => onResult(false),
        ),
      );
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [lessonId, materialId, onResult]);

  return (
    <iframe
      ref={frame}
      title={title}
      src={`/api/files/library/${materialId}`}
      sandbox={GAME_SANDBOX}
      referrerPolicy="no-referrer"
      className="h-full min-h-[60vh] w-full rounded-card border border-border bg-bg"
    />
  );
}
