"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { routerClient } from "./router-client";

/**
 * «Фидбэк» came on the screen (#333; product owner, 2026-11-24: scrolled to,
 * not just the card opened): its answers are seen, and the student leaves
 * «Новый фидбэк» on the general screen. Wraps the block it watches; a failure
 * leaves the mark for the next visit.
 */
export function FeedbackSeen({ studentId, children }: { studentId: string; children: ReactNode }) {
  const block = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = block.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      routerClient.teacher.students.seeFeedback.mutate({ studentId }).catch(() => undefined);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [studentId]);
  return <div ref={block}>{children}</div>;
}
