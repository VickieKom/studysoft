"use client";

import { useEffect, useRef, useState } from "react";
import { looksLikeGameResult } from "@/domain/game-result-format";
import { GAME_SANDBOX } from "@/domain/library";
import { routerClient } from "./router-client";

const field = "h-10 rounded-control border border-border bg-bg px-3";

/**
 * A game on the teacher's page (#115), in its sandboxed frame. When she runs
 * it with a student during their lesson, a result the game posts in the
 * game result format goes to that student and lesson (#147): with one
 * lesson going on, its student; with several, the one she picks; with none,
 * nothing is kept. Only messages from this frame count, and the server
 * checks the format and the lesson again.
 */
export function LibraryGameFrame({
  id,
  title,
  fileUrl,
  students,
}: {
  id: string;
  title: string;
  fileUrl: string;
  students: { studentId: string; name: string }[];
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [studentId, setStudentId] = useState(students.length === 1 ? students[0]!.studentId : "");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow || !looksLikeGameResult(event.data) || !studentId) return;
      setError(null);
      routerClient.teacher.library.saveLessonResult
        .mutate({ id, studentId, result: event.data })
        .catch(() => setError("Итог игры не сохранился: урок уже закончился или игра прислала его не по формату"));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [id, studentId]);

  return (
    <div className="flex flex-col gap-2">
      {students.length === 0 && (
        <p className="text-small text-text-secondary">Сейчас нет урока: итог игры не сохранится</p>
      )}
      {students.length === 1 && <p className="text-small text-text-secondary">Итог — в урок с: {students[0]!.name}</p>}
      {students.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="game-result-student" className="text-small text-text-secondary">
            Итог — в урок с
          </label>
          <select id="game-result-student" value={studentId} onChange={(e) => setStudentId(e.target.value)} className={field}>
            <option value="">выберите ученика</option>
            {students.map((s) => (
              <option key={s.studentId} value={s.studentId}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
      <iframe
        ref={frame}
        title={title}
        src={fileUrl}
        sandbox={GAME_SANDBOX}
        referrerPolicy="no-referrer"
        className="h-[70vh] w-full rounded-card border border-border bg-bg"
      />
    </div>
  );
}
