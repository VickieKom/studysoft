"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_SPEAKING_SECONDS } from "@/domain/assessment-answers";
import { assessmentFileUrl } from "@/domain/assessment";
import { Button } from "./button";
import { routerClient } from "./router-client";

type LessonAssessmentRow = { id: string; title: string; taking: string; speakingRecording: string | null };

const RECORDING_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
const minutes = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** A procedure's own message for a refusal the teacher can act on, else a general one. */
function message(cause: unknown): string {
  const code = (cause as { data?: { code?: string } } | null)?.data?.code;
  return code === "BAD_REQUEST" && cause instanceof Error ? cause.message : "Не получилось. Проверьте интернет и попробуйте ещё раз";
}

/**
 * «Замер» on the lesson panel (#253): the student's approved assessments
 * still to be taken. The teacher opens one to the child, and records
 * «Говорение» from her microphone while the child answers in the call:
 * «Записать», then «Остановить»; the recording, at most 5 minutes, is kept
 * with the assessment. Nothing of it reaches the stage.
 */
export function LessonAssessment({ lessonId }: { lessonId: string }) {
  const [assessments, setAssessments] = useState<LessonAssessmentRow[] | null>(null);
  const [chosen, setChosen] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [version, setVersion] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const show = useCallback((rows: LessonAssessmentRow[]) => {
    setAssessments(rows);
    setChosen((before) => (rows.some((r) => r.id === before) ? before : (rows[0]?.id ?? "")));
  }, []);
  const load = useCallback(async () => show(await routerClient.teacher.assessments.forLesson.query({ lessonId })), [lessonId, show]);

  useEffect(() => {
    let live = true;
    routerClient.teacher.assessments.forLesson
      .query({ lessonId })
      .then((rows) => live && show(rows))
      .catch(() => live && show([]));
    return () => {
      live = false;
    };
  }, [lessonId, show]);

  const stop = () => {
    clearInterval(timer.current);
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
  };
  useEffect(() => stop, []);

  if (!assessments || assessments.length === 0) return null;
  const current = assessments.find((a) => a.id === chosen) ?? assessments[0]!;

  async function open() {
    setBusy(true);
    setError(null);
    try {
      await routerClient.teacher.assessments.open.mutate({ assessmentId: current.id });
      await load();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function record() {
    setError(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Этот браузер не умеет записывать звук. Откройте пульт в Chrome или Safari");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Нет доступа к микрофону. Разрешите его в настройках браузера");
      return;
    }
    const mimeType = RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    const media = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    const id = current.id;
    media.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    media.onstop = async () => {
      clearInterval(timer.current);
      for (const track of stream.getTracks()) track.stop();
      setRecording(false);
      setBusy(true);
      try {
        const response = await fetch(assessmentFileUrl(id, "speaking"), {
          method: "PUT",
          body: new Blob(chunks, { type: media.mimeType || mimeType || "audio/webm" }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          setError(body?.error ?? "Не получилось сохранить запись. Попробуйте ещё раз");
        }
        await load();
        setVersion((v) => v + 1);
      } catch {
        setError("Не получилось сохранить запись. Проверьте интернет");
      } finally {
        setBusy(false);
      }
    };
    recorder.current = media;
    const startedAt = Date.now();
    setSeconds(0);
    timer.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setSeconds(Math.min(elapsed, MAX_SPEAKING_SECONDS));
      if (elapsed >= MAX_SPEAKING_SECONDS) stop();
    }, 250);
    media.start();
    setRecording(true);
  }

  return (
    <section aria-label="Замер" className="flex flex-col gap-3 rounded-card border border-border p-4">
      <h2 className="font-semibold">Замер</h2>
      <label className="flex flex-col gap-1 text-small">
        <span className="text-text-secondary">Замер ученика</span>
        <select
          aria-label="Замер ученика"
          value={current.id}
          disabled={recording}
          onChange={(event) => setChosen(event.target.value)}
          className="rounded-control border border-border bg-bg px-3 py-2"
        >
          {assessments.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </select>
      </label>
      {current.taking === "open" ? (
        <p className="text-small text-accent-900">Открыт ученику</p>
      ) : (
        <div>
          <Button disabled={busy} onClick={() => void open()}>
            Открыть ученику
          </Button>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <p className="text-small text-text-secondary">Говорение: запишите ответы ученика с вашего микрофона</p>
        {recording ? (
          <>
            <p className="text-small text-text-secondary">
              Идёт запись {minutes(seconds)} из {minutes(MAX_SPEAKING_SECONDS)}
            </p>
            <div>
              <Button onClick={stop}>Остановить</Button>
            </div>
          </>
        ) : (
          <>
            {current.speakingRecording && (
              <audio key={version} controls preload="metadata" src={current.speakingRecording} aria-label="Запись говорения" />
            )}
            <div>
              <Button variant="secondary" disabled={busy} onClick={() => void record()}>
                {current.speakingRecording ? "Записать заново" : "Записать"}
              </Button>
            </div>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
