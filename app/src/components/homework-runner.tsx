"use client";

import { useEffect, useRef, useState } from "react";
import { answerFileUrl } from "@/domain/homework";
import {
  type Answer,
  gapCount,
  isAnswered,
  MAX_ANSWER_FILE_BYTES,
  MAX_VOICE_SECONDS,
  MAX_WRITTEN_CHARS,
  type StudentAnswer,
  type StudentTask,
} from "@/domain/homework-format";
import { HomeworkResult } from "./homework-result";
import { routerClient } from "./router-client";

type Props = {
  homeworkId: string;
  firstName: string;
  dueLabel: string;
  tasksLabel: string;
  tasks: StudentTask[];
  answers: (StudentAnswer | null)[];
};

const tile =
  "min-h-12 rounded-task border-2 px-4 py-2 text-answer font-semibold break-words transition-colors disabled:opacity-60";
const tileState = (on: boolean) =>
  on ? "border-accent-600 bg-accent-100 text-accent-900" : "border-border bg-bg text-text hover:bg-surface";

// Typed gaps are saved a moment after the student stops typing; choices at once.
const TYPING_PAUSE_MS = 600;

const UPLOAD_FAILED = "Не получилось сохранить. Проверьте интернет и попробуйте ещё раз";

/**
 * The student does a published homework (#34): a start screen, one task per
 * screen with a progress bar, «Сдать» once. Every answer is saved on the
 * server as it changes, so another device picks up where this one stopped.
 * Correctness is never shown here: the server checks and gives only the score.
 */
export function HomeworkRunner({ homeworkId, firstName, dueLabel, tasksLabel, tasks, answers: saved }: Props) {
  const [index, setIndex] = useState(-1);
  const [answers, setAnswers] = useState<(StudentAnswer | null)[]>(saved);
  const [unanswered, setUnanswered] = useState<number[] | null>(null);
  const [result, setResult] = useState<{ correct: number; wrong: number; pending: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const latest = useRef(saved);
  const dirty = useRef(new Set<number>());
  const chains = useRef(new Map<number, Promise<void>>());
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  // One key for this page's «Сдать»: a double tap or a retry gets the same result.
  const submitKey = useRef<string | null>(null);

  function save(taskIndex: number): Promise<void> {
    dirty.current.delete(taskIndex);
    const current = latest.current[taskIndex] ?? null;
    // A recording or a file is saved by its upload; there is nothing to send here.
    const answer: Answer | null = current?.type === "voice" || current?.type === "file" ? null : current;
    if (current && !answer) return chains.current.get(taskIndex) ?? Promise.resolve();
    const previous = chains.current.get(taskIndex) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => routerClient.student.homework.saveAnswer.mutate({ id: homeworkId, taskIndex, answer }))
      .then(
        () => setError(null),
        (cause: unknown) => {
          dirty.current.add(taskIndex);
          setError("Не получилось сохранить ответ. Проверьте интернет и попробуйте ещё раз");
          throw cause;
        },
      );
    chains.current.set(taskIndex, next);
    return next;
  }

  function remember(taskIndex: number, answer: StudentAnswer | null) {
    latest.current = latest.current.map((a, i) => (i === taskIndex ? answer : a));
    setAnswers(latest.current);
    setUnanswered(null);
  }

  function update(taskIndex: number, answer: Answer | null, typing = false) {
    remember(taskIndex, answer);
    dirty.current.add(taskIndex);
    clearTimeout(timers.current.get(taskIndex));
    if (typing) timers.current.set(taskIndex, setTimeout(() => void save(taskIndex).catch(() => undefined), TYPING_PAUSE_MS));
    else void save(taskIndex).catch(() => undefined);
  }

  /**
   * Uploads a recording or a file as the answer to a task (#35). The upload is
   * the save: the server keeps the file and the answer. Resolves to the
   * message to show when it was refused or failed, or null. «Дальше» and
   * «Сдать» wait for it like for any save.
   */
  function upload(taskIndex: number, body: Blob): Promise<string | null> {
    const task = tasks[taskIndex]!;
    const previous = chains.current.get(taskIndex) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(async () => {
        try {
          const response = await fetch(answerFileUrl(homeworkId, taskIndex), {
            method: "PUT",
            body,
            headers: { "Content-Type": body.type || "application/octet-stream" },
          });
          const payload = (await response.json().catch(() => null)) as
            | { url?: string; contentType?: string; error?: string }
            | null;
          if (response.ok && payload?.url && payload.contentType && (task.type === "voice" || task.type === "file")) {
            remember(taskIndex, { type: task.type, url: payload.url, contentType: payload.contentType });
            return null;
          }
          // Submitted from another device, or taken back by the teacher: the page shows what is current now.
          if (response.status === 404) window.location.reload();
          return payload?.error ?? UPLOAD_FAILED;
        } catch {
          return UPLOAD_FAILED;
        }
      });
    chains.current.set(
      taskIndex,
      run.then(() => undefined),
    );
    return run;
  }

  /** Saves whatever is still unsaved and waits for every save in flight. */
  async function flush(): Promise<boolean> {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
    for (const taskIndex of [...dirty.current]) void save(taskIndex).catch(() => undefined);
    const results = await Promise.allSettled(chains.current.values());
    return results.every((r) => r.status === "fulfilled");
  }

  /**
   * Moves to another task at once; what is still unsaved goes on saving in
   * the background (#35: a typed answer or an upload must not hold the
   * student on the task). «Сдать» waits for every save.
   */
  function go(to: number) {
    void flush();
    setUnanswered(null);
    setIndex(to);
  }

  async function submit(confirmed: boolean) {
    setBusy(true);
    try {
      if (!(await flush())) return;
      const missing = tasks.flatMap((task, i) => (isAnswered(task, latest.current[i]) ? [] : [i + 1]));
      if (missing.length > 0 && !confirmed) {
        setUnanswered(missing);
        return;
      }
      submitKey.current ??= crypto.randomUUID();
      setResult(await routerClient.student.homework.submit.mutate({ id: homeworkId, idempotencyKey: submitKey.current }));
    } catch (cause) {
      const code = (cause as { data?: { code?: string } } | null)?.data?.code;
      // Submitted from another device, or taken back by the teacher: the page
      // shows what is current now.
      if (code === "CONFLICT" || code === "NOT_FOUND") window.location.reload();
      else setError("Не получилось сдать. Проверьте интернет и нажмите «Сдать» ещё раз");
    } finally {
      setBusy(false);
    }
  }

  if (result) return <HomeworkResult firstName={firstName} {...result} />;

  if (index < 0) {
    return (
      <main className="flex flex-col gap-6">
        <h1 className="text-task-title font-bold">Привет, {firstName}!</h1>
        <div className="flex flex-col items-center gap-4 rounded-task border border-border bg-accent-50 px-6 py-10 text-center">
          <p className="text-answer font-semibold text-accent-900">Домашка к {dueLabel}</p>
          <p className="text-text-secondary">{tasksLabel}</p>
          <button
            type="button"
            onClick={() => setIndex(0)}
            className="h-12 w-full rounded-task bg-accent-600 px-6 text-answer font-semibold text-on-accent hover:bg-accent-700"
          >
            Начать
          </button>
        </div>
      </main>
    );
  }

  const task = tasks[index]!;
  const last = index === tasks.length - 1;

  return (
    <main className="flex flex-col gap-6">
      <header className="flex items-center gap-3">
        <div
          role="progressbar"
          aria-label="Прогресс"
          aria-valuemin={0}
          aria-valuemax={tasks.length}
          aria-valuenow={index + 1}
          className="h-3 flex-1 overflow-hidden rounded-full bg-surface"
        >
          <div className="h-full rounded-full bg-accent-500" style={{ width: `${((index + 1) / tasks.length) * 100}%` }} />
        </div>
        <span className="text-small text-text-secondary">
          {index + 1} / {tasks.length}
        </span>
      </header>

      <h1 className="text-task-title font-bold">{task.prompt}</h1>
      {task.image && (
        // biome-ignore lint/performance/noImgElement: the image optimiser fetches without the user's session, so a permission-checked file cannot go through it
        // eslint-disable-next-line @next/next/no-img-element -- same reason as above
        <img src={task.image} alt="Картинка к заданию" className="max-h-72 w-full rounded-task object-contain" />
      )}
      <TaskBody
        key={index}
        task={task}
        answer={answers[index] ?? null}
        onChange={(answer, typing) => update(index, answer, typing)}
        upload={(body) => upload(index, body)}
      />
      <p className="text-small text-text-secondary">Ответы проверим вместе на уроке</p>

      {error && (
        <p role="alert" className="rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}
      {unanswered && (
        <div role="alert" className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
          <p>
            {unanswered.length === 1 ? "Без ответа задание" : "Без ответа задания"} {unanswered.join(", ")}
          </p>
          <div className="flex flex-wrap gap-2">
            <NavButton onClick={() => go(unanswered[0]! - 1)} disabled={busy} secondary>
              Вернуться к заданию
            </NavButton>
            <NavButton onClick={() => submit(true)} disabled={busy}>
              Всё равно сдать
            </NavButton>
          </div>
        </div>
      )}

      <nav className="flex gap-3">
        {index > 0 && (
          <NavButton onClick={() => go(index - 1)} disabled={busy} secondary>
            Назад
          </NavButton>
        )}
        {last ? (
          <NavButton onClick={() => submit(false)} disabled={busy}>
            Сдать
          </NavButton>
        ) : (
          <NavButton onClick={() => go(index + 1)} disabled={busy}>
            Дальше
          </NavButton>
        )}
      </nav>
    </main>
  );
}

function NavButton({
  children,
  onClick,
  disabled,
  secondary = false,
}: {
  children: string;
  onClick: () => void;
  disabled: boolean;
  secondary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`h-12 flex-1 rounded-task px-6 text-answer font-semibold disabled:opacity-60 ${
        secondary ? "border-2 border-border bg-bg text-text" : "bg-accent-600 text-on-accent hover:bg-accent-700"
      }`}
    >
      {children}
    </button>
  );
}

type BodyProps = {
  task: StudentTask;
  answer: StudentAnswer | null;
  onChange: (answer: Answer | null, typing?: boolean) => void;
};

function TaskBody({ task, answer, onChange, upload }: BodyProps & { upload: (body: Blob) => Promise<string | null> }) {
  switch (task.type) {
    case "single_choice":
    case "multiple_choice":
      return <Choice task={task} answer={answer} onChange={onChange} />;
    case "gap":
      return <Gap task={task} answer={answer} onChange={onChange} />;
    case "match":
      return <Match task={task} answer={answer} onChange={onChange} />;
    case "order":
      return <Order task={task} answer={answer} onChange={onChange} />;
    case "written":
      return <Written task={task} answer={answer} onChange={onChange} />;
    case "voice":
      return <Voice hint={task.hint} answer={answer} upload={upload} />;
    case "file":
      return <Attachment task={task} answer={answer} upload={upload} />;
  }
}

function Choice({ task, answer, onChange }: BodyProps & { task: { type: "single_choice" | "multiple_choice"; options: string[] } }) {
  const chosen =
    answer?.type === "single_choice" ? [answer.choice] : answer?.type === "multiple_choice" ? answer.choices : [];
  function toggle(i: number) {
    if (task.type === "single_choice") return onChange({ type: "single_choice", choice: i });
    const choices = chosen.includes(i) ? chosen.filter((c) => c !== i) : [...chosen, i].sort((a, b) => a - b);
    onChange(choices.length > 0 ? { type: "multiple_choice", choices } : null);
  }
  return (
    <div className="flex flex-col gap-3">
      {task.type === "multiple_choice" && <p className="text-small text-text-secondary">Можно выбрать несколько</p>}
      <div className="grid grid-cols-2 gap-3">
        {task.options.map((option, i) => (
          <button
            key={i}
            type="button"
            aria-pressed={chosen.includes(i)}
            onClick={() => toggle(i)}
            className={`${tile} ${tileState(chosen.includes(i))}`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function Gap({ task, answer, onChange }: BodyProps & { task: { type: "gap"; text: string; options?: string[] } }) {
  const count = gapCount(task.text);
  const gaps = answer?.type === "gap" ? answer.gaps : Array.from({ length: count }, () => "");
  const parts = task.text.split("___");
  function set(i: number, value: string, typing: boolean) {
    const next = gaps.map((g, j) => (j === i ? value : g));
    onChange(next.every((g) => g === "") ? null : { type: "gap", gaps: next }, typing);
  }
  return (
    <p className="text-answer leading-10">
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < count &&
            (task.options ? (
              <select
                aria-label={`Пропуск ${i + 1}`}
                value={gaps[i] ?? ""}
                onChange={(event) => set(i, event.target.value, false)}
                className="mx-1 h-11 rounded-control border-2 border-border bg-bg px-2"
              >
                <option value="">…</option>
                {task.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                aria-label={`Пропуск ${i + 1}`}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={gaps[i] ?? ""}
                onChange={(event) => set(i, event.target.value, true)}
                className="mx-1 h-11 w-36 max-w-full rounded-control border-2 border-border bg-bg px-2"
              />
            ))}
        </span>
      ))}
    </p>
  );
}

function Match({ task, answer, onChange }: BodyProps & { task: { type: "match"; left: string[]; right: string[] } }) {
  const [selected, setSelected] = useState<string | null>(null);
  const pairs = answer?.type === "match" ? answer.pairs : [];
  const pairOfLeft = (left: string) => pairs.find((p) => p.left === left);
  const pairOfRight = (right: string) => pairs.find((p) => p.right === right);
  const emit = (next: { left: string; right: string }[]) => onChange(next.length > 0 ? { type: "match", pairs: next } : null);

  function pickLeft(left: string) {
    if (pairOfLeft(left)) emit(pairs.filter((p) => p.left !== left));
    setSelected(selected === left ? null : left);
  }
  function pickRight(right: string) {
    if (!selected) {
      if (pairOfRight(right)) emit(pairs.filter((p) => p.right !== right));
      return;
    }
    emit([...pairs.filter((p) => p.left !== selected && p.right !== right), { left: selected, right }]);
    setSelected(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-3">
          {task.left.map((left) => (
            <button
              key={left}
              type="button"
              aria-pressed={selected === left || Boolean(pairOfLeft(left))}
              onClick={() => pickLeft(left)}
              className={`${tile} ${tileState(selected === left)} ${pairOfLeft(left) ? "opacity-50" : ""}`}
            >
              {left}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-3">
          {task.right.map((right) => (
            <button
              key={right}
              type="button"
              aria-pressed={Boolean(pairOfRight(right))}
              onClick={() => pickRight(right)}
              className={`${tile} ${tileState(false)} ${pairOfRight(right) ? "opacity-50" : ""}`}
            >
              {right}
            </button>
          ))}
        </div>
      </div>
      {pairs.length > 0 && (
        <ul className="flex flex-col gap-1 text-text-secondary">
          {pairs.map((p) => (
            <li key={p.left}>
              {p.left} — {p.right}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Order({ task, answer, onChange }: BodyProps & { task: { type: "order"; words: string[] } }) {
  // The placed words as positions in the pool, so repeated words stay apart.
  const placed: number[] = [];
  for (const word of answer?.type === "order" ? answer.words : []) {
    const at = task.words.findIndex((w, i) => w === word && !placed.includes(i));
    if (at >= 0) placed.push(at);
  }
  const emit = (next: number[]) =>
    onChange(next.length > 0 ? { type: "order", words: next.map((i) => task.words[i]!) } : null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-h-16 flex-wrap gap-2 rounded-card border-2 border-dashed border-border p-3">
        {placed.map((at) => (
          <button
            key={at}
            type="button"
            onClick={() => emit(placed.filter((i) => i !== at))}
            className={`${tile} ${tileState(true)}`}
          >
            {task.words[at]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {task.words.map((word, at) =>
          placed.includes(at) ? (
            <span key={at} aria-hidden="true" className="min-h-12 min-w-12 rounded-task bg-surface" />
          ) : (
            <button key={at} type="button" onClick={() => emit([...placed, at])} className={`${tile} ${tileState(false)}`}>
              {word}
            </button>
          ),
        )}
      </div>
      {placed.length > 0 && (
        <button type="button" onClick={() => emit([])} className="self-start text-small text-text-secondary underline">
          Очистить
        </button>
      )}
    </div>
  );
}

function Written({ task, answer, onChange }: BodyProps & { task: { hint?: string } }) {
  const text = answer?.type === "written" ? answer.text : "";
  return (
    <label className="flex flex-col gap-2">
      <span className="text-small text-text-secondary">Ваш ответ</span>
      {task.hint && <span className="text-small text-text-secondary">{task.hint}</span>}
      <textarea
        rows={6}
        maxLength={MAX_WRITTEN_CHARS}
        value={text}
        onChange={(event) => onChange(event.target.value === "" ? null : { type: "written", text: event.target.value }, true)}
        className="rounded-control border-2 border-border bg-bg p-3 text-answer"
      />
    </label>
  );
}

const minutes = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

// What browsers record in: WebM in Chrome and Firefox, MP4 in Safari. Stored as recorded (architecture 11.1).
const RECORDING_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

const notice = "rounded-control bg-danger-bg px-3 py-2 text-small text-danger";
const actionButton =
  "h-12 rounded-task border-2 border-accent-600 bg-bg px-6 text-answer font-semibold text-accent-900 hover:bg-accent-50 disabled:opacity-60";

/**
 * A voice answer (#35): «Записать», «Остановить», listen, «Записать заново».
 * The recording is uploaded as soon as it stops, and stops by itself at the
 * limit; the server refuses a longer one anyway.
 */
function Voice({
  hint,
  answer,
  upload,
}: {
  hint?: string;
  answer: StudentAnswer | null;
  upload: (body: Blob) => Promise<string | null>;
}) {
  const [state, setState] = useState<"idle" | "recording" | "saving">("idle");
  const [seconds, setSeconds] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  // A new recording keeps the address: a fresh <audio> asks the server again.
  const [version, setVersion] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const stop = () => {
    clearInterval(timer.current);
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
  };
  // Leaving the task while recording stops and keeps what was said.
  useEffect(() => stop, []);

  async function start() {
    setMessage(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setMessage("Этот браузер не умеет записывать звук. Откройте ссылку в Chrome или Safari");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setMessage("Нет доступа к микрофону. Разрешите его в настройках браузера");
      return;
    }
    const mimeType = RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    const media = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    media.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    media.onstop = async () => {
      clearInterval(timer.current);
      for (const track of stream.getTracks()) track.stop();
      setState("saving");
      const error = await upload(new Blob(chunks, { type: media.mimeType || mimeType || "audio/webm" }));
      setMessage(error);
      setVersion((v) => v + 1);
      setState("idle");
    };
    recorder.current = media;
    const startedAt = Date.now();
    setSeconds(0);
    timer.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setSeconds(Math.min(elapsed, MAX_VOICE_SECONDS));
      if (elapsed >= MAX_VOICE_SECONDS) stop();
    }, 250);
    media.start();
    setState("recording");
  }

  return (
    <div className="flex flex-col gap-3">
      {hint && <p className="text-small text-text-secondary">{hint}</p>}
      {state === "recording" ? (
        <>
          <p className="text-answer text-text-secondary">
            Идёт запись {minutes(seconds)} из {minutes(MAX_VOICE_SECONDS)}
          </p>
          <button type="button" onClick={stop} className={actionButton}>
            Остановить
          </button>
        </>
      ) : state === "saving" ? (
        <p className="text-answer text-text-secondary">Сохраняем запись…</p>
      ) : (
        <>
          {answer?.type === "voice" && (
            <>
              <audio key={version} controls preload="metadata" src={answer.url} className="w-full" />
              <p className="text-small text-text-secondary">Запись сохранена</p>
            </>
          )}
          <button type="button" onClick={() => void start()} className={actionButton}>
            {answer?.type === "voice" ? "Записать заново" : "Записать"}
          </button>
          <p className="text-small text-text-secondary">До {minutes(MAX_VOICE_SECONDS).replace(":00", "")} минут</p>
        </>
      )}
      {message && (
        <p role="alert" className={notice}>
          {message}
        </p>
      )}
    </div>
  );
}

/** A photo of a notebook page or an audio file, from the camera or the files (#35). */
function Attachment({
  task,
  answer,
  upload,
}: {
  task: { type: "file"; accept: ("image" | "audio")[]; hint?: string };
  answer: StudentAnswer | null;
  upload: (body: Blob) => Promise<string | null>;
}) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  async function attach(file: File | undefined) {
    if (!file) return;
    setMessage(null);
    if (file.size > MAX_ANSWER_FILE_BYTES) {
      setMessage("Файл больше 10 МБ. Выберите файл поменьше");
      return;
    }
    setSaving(true);
    setMessage(await upload(file));
    setVersion((v) => v + 1);
    setSaving(false);
  }

  return (
    <div className="flex flex-col gap-3">
      {task.hint && <p className="text-small text-text-secondary">{task.hint}</p>}
      {answer?.type === "file" &&
        !saving &&
        (answer.contentType.startsWith("image/") ? (
          // biome-ignore lint/performance/noImgElement: the image optimiser fetches without the user's session, so a permission-checked file cannot go through it
          // eslint-disable-next-line @next/next/no-img-element -- same reason as above
          <img key={version} src={answer.url} alt="Ваше фото" className="max-h-72 w-full rounded-task object-contain" />
        ) : (
          <audio key={version} controls preload="metadata" src={answer.url} className="w-full" />
        ))}
      {saving && <p className="text-answer text-text-secondary">Сохраняем файл…</p>}
      <label className={`${actionButton} flex cursor-pointer items-center justify-center`}>
        Прикрепить фото или аудио
        <input
          type="file"
          accept={task.accept.map((kind) => `${kind}/*`).join(",")}
          disabled={saving}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            void attach(file);
          }}
          className="sr-only"
        />
      </label>
      <p className="text-small text-text-secondary">До 10 МБ</p>
      {message && (
        <p role="alert" className={notice}>
          {message}
        </p>
      )}
    </div>
  );
}
