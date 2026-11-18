"use client";

import { useEffect, useRef } from "react";
import { looksLikeGameResult } from "@/domain/game-result-format";
import { GAME_SANDBOX } from "@/domain/library";
import { routerClient } from "./router-client";

/**
 * A game the teacher opened to the student (#118), in the same sandboxed
 * frame as hers. A result the game posts in the game result format (#119)
 * goes to the platform; only messages from this frame count, and the server
 * checks the format again and whether the game is still open. The student
 * is not told either way: the game shows its own result.
 */
export function StudentGameFrame({ id, title, fileUrl }: { id: string; title: string; fileUrl: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow || !looksLikeGameResult(event.data)) return;
      // A result that is not kept (not in the format, or the access has ended) changes nothing for the game.
      routerClient.student.games.saveResult.mutate({ id, result: event.data }).catch(() => undefined);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [id]);
  return (
    <iframe
      ref={frame}
      title={title}
      src={fileUrl}
      sandbox={GAME_SANDBOX}
      referrerPolicy="no-referrer"
      className="h-[75vh] w-full rounded-task border border-border bg-bg"
    />
  );
}
