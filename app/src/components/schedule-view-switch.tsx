"use client";

import Link from "next/link";
import { useEffect } from "react";
import { SCHEDULE_VIEW_COOKIE, SCHEDULE_VIEW_LABELS, SCHEDULE_VIEWS, type ScheduleView } from "@/domain/schedule";

const ONE_YEAR = 365 * 24 * 60 * 60;

/**
 * «День / Неделя / Список» (#85). The view on screen is remembered in this
 * browser, so «Расписание» opens with it next time.
 */
export function ScheduleViewSwitch({ view }: { view: ScheduleView }) {
  useEffect(() => {
    document.cookie = `${SCHEDULE_VIEW_COOKIE}=${view}; path=/teacher; max-age=${ONE_YEAR}; samesite=lax`;
  }, [view]);

  return (
    <nav aria-label="Вид расписания" className="flex gap-1 rounded-control border border-border p-1">
      {SCHEDULE_VIEWS.map((v) => (
        <Link
          key={v}
          href={`/teacher/schedule?view=${v}`}
          aria-current={v === view ? "page" : undefined}
          className={`rounded-control px-3 py-1 font-semibold ${v === view ? "bg-accent-50" : "hover:bg-surface"}`}
        >
          {SCHEDULE_VIEW_LABELS[v]}
        </Link>
      ))}
    </nav>
  );
}
