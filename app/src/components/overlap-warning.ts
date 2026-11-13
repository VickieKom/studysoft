"use client";

import { useRef, useState } from "react";
import { overlapWarning } from "@/domain/schedule";
import { routerClient } from "./router-client";

type At = { studentId: string; date: string; time: string; durationMinutes: number; exceptLessonId?: string };

/**
 * The overlap warning while a time is being chosen (#81): «в это время уже
 * урок с …», or null. Only the latest check counts, so a slow answer for a
 * time already changed never shows. It only warns: saving stays allowed.
 */
export function useOverlapWarning(): [string | null, (at: At) => void] {
  const [warning, setWarning] = useState<string | null>(null);
  const latest = useRef(0);

  function check(at: At) {
    const request = ++latest.current;
    if (!at.studentId || !at.date || !/^\d{2}:\d{2}$/.test(at.time)) return setWarning(null);
    routerClient.teacher.schedule.overlaps
      .query({ ...at, durationMinutes: at.durationMinutes as 45 | 60 | 90 })
      .then(({ names }) => {
        if (request === latest.current) setWarning(names.length > 0 ? overlapWarning(names) : null);
      })
      .catch(() => {
        if (request === latest.current) setWarning(null);
      });
  }

  return [warning, check];
}
