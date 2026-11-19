"use client";

import { useEffect, useRef, useState } from "react";
import {
  bookStageLabel,
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
} from "@/domain/lesson-state";
import type { LessonResourcesView } from "./lesson-panel";

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
 * content — the stages as tabs, the warm-up, the book's pages, the track —
 * never the plan's minutes, the note or the platform's menu. It follows the
 * panel over BroadcastChannel; opened again, it starts from the state this
 * browser kept, or the server's — so it is rendered in the browser alone
 * (lesson-mode-client.tsx).
 */
export function LessonStage({ lessonId, resources, serverKept }: { lessonId: string; resources: LessonResourcesView; serverKept: KeptState }) {
  // Opened again, the stage starts where this browser left it, unless the server's is newer.
  const [kept, setKept] = useState<KeptState>(() => newer(serverKept, readLocal(lessonId))!);
  const [soundOn, setSoundOn] = useState(false);
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
      }
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
  const lessonOf = (id: string) => resources.lessons.find((l) => l.id === id);
  const materialOf = (id: string) => resources.materials.find((m) => m.id === id);

  return (
    <div className="flex h-screen gap-4 bg-surface p-4">
      <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden rounded-card border border-border bg-bg p-4">
        <div role="tablist" aria-label="Этапы урока" className="flex flex-wrap gap-2">
          {state.stages.map((stage, i) => (
            <span
              key={`${i}-${stage.type === "book" ? stage.lessonId : stage.materialId}`}
              role="tab"
              aria-selected={i === state.current}
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-small font-semibold ${
                i === state.current ? "bg-green-600 text-on-accent" : stage.done ? "bg-green-50 text-green-700" : "bg-surface text-text-secondary"
              }`}
            >
              {stage.done && i !== state.current && <Tick />}
              {stage.type === "book" ? bookStageLabel(lessonOf(stage.lessonId)) : (materialOf(stage.materialId)?.title ?? "")}
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
          {current?.type === "material" &&
            (() => {
              const material = materialOf(current.materialId);
              if (!material) return null;
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

      {/* The board's place, kept for the board issue (#155). */}
      <aside aria-hidden="true" className="w-72 shrink-0 rounded-card border-8 border-[#5b4a3a] bg-[#2f3432]" />

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
