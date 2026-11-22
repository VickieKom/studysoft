"use client";

import { type RefObject, useEffect } from "react";
import { gameWordsMessage, isWordsRequest } from "@/domain/game-words-format";
import { routerClient } from "./router-client";

/** Whose words a game template gets (#282), by where it runs. */
export type WordsSource =
  | { kind: "library"; id: string; studentId: string }
  | { kind: "stage"; lessonId: string; materialId: string }
  | { kind: "student"; id: string };

function load(source: WordsSource) {
  if (source.kind === "library") return routerClient.teacher.library.words.query({ id: source.id, studentId: source.studentId });
  if (source.kind === "stage") return routerClient.teacher.lessonMode.gameWords.query({ lessonId: source.lessonId, materialId: source.materialId });
  return routerClient.student.games.words.query({ id: source.id });
}

/**
 * Sends a game template the words of `source` in the words format: when they
 * arrive, when the frame has loaded, and whenever the game asks again. The
 * frame's origin is its own (the sandbox), so the target is "*"; the words are
 * the student's own, which they see on their page anyway. With no source,
 * nothing is sent. A failed load sends nothing: the game shows its own state.
 */
export function useGameWords(frame: RefObject<HTMLIFrameElement | null>, source: WordsSource | null) {
  const key = source ? JSON.stringify(source) : null;
  useEffect(() => {
    if (!key) return;
    const wanted = JSON.parse(key) as WordsSource;
    let message: ReturnType<typeof gameWordsMessage> | null = null;
    let gone = false;
    const send = () => {
      if (message) frame.current?.contentWindow?.postMessage(message, "*");
    };
    load(wanted).then(
      ({ words }) => {
        if (gone) return;
        message = gameWordsMessage(words);
        send();
      },
      () => undefined,
    );
    const element = frame.current;
    element?.addEventListener("load", send);
    const onMessage = (event: MessageEvent) => {
      if (event.source === frame.current?.contentWindow && isWordsRequest(event.data)) send();
    };
    window.addEventListener("message", onMessage);
    return () => {
      gone = true;
      element?.removeEventListener("load", send);
      window.removeEventListener("message", onMessage);
    };
  }, [frame, key]);
}
