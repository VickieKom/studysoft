"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { routerClient } from "./router-client";

/**
 * «Фидбэк» came on the screen (#333; product owner, 2026-11-24: scrolled to,
 * not just the card opened): the answers it shows, up to `upTo`, the newest,
 * are seen, and the student leaves «Новый фидбэк» on the general screen until
 * a newer one. Wraps the block it watches; a failure leaves the mark for the
 * next visit. Nothing shown, nothing seen.
 */
export function FeedbackSeen({ studentId, upTo, children }: { studentId: string; upTo: string | null; children: ReactNode }) {
  const block = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = block.current;
    if (!element || upTo === null) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      routerClient.teacher.students.seeFeedback.mutate({ studentId, upTo }).catch(() => undefined);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [studentId, upTo]);
  return <div ref={block}>{children}</div>;
}
