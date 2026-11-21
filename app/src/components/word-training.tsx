"use client";

import { useId, useState } from "react";
import type { ExerciseType } from "@/domain/word-training";
import { routerClient } from "./router-client";

type Exercise = { wordId: string; type: ExerciseType; prompt: string; options: string[] | null };
type Result = { right: boolean; correct: string };

const big = "h-12 rounded-task px-6 text-answer font-semibold disabled:opacity-60";
const primary = `${big} bg-accent-600 text-on-accent hover:bg-accent-700`;
const tile = "min-h-12 rounded-task border-2 border-border bg-bg px-4 py-2 text-answer font-semibold hover:bg-surface disabled:opacity-60";

const QUESTION: Record<ExerciseType, (prompt: string) => string> = {
  choose_translation: (prompt) => `Как переводится «${prompt}»?`,
  choose_word: (prompt) => `Какое слово значит «${prompt}»?`,
  type_word: (prompt) => `Напиши по-английски: «${prompt}»`,
};

/**
 * «Тренировка» (#238): today's words, one exercise each, checked on the
 * server; after an answer the child sees at once whether it was right and the
 * right answer. Then «На сегодня всё», and «Ещё разок» for more of their
 * words, which moves nothing in the schedule.
 */
export function WordTraining({ dueCount }: { dueCount: number }) {
  const [due, setDue] = useState(dueCount);
  const [session, setSession] = useState<{ exercises: Exercise[]; extra: boolean; index: number } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(extra: boolean) {
    setBusy(true);
    setError(null);
    try {
      const exercises = await routerClient.student.vocabulary.training.query({ extra });
      setSession(exercises.length > 0 ? { exercises, extra, index: 0 } : null);
      setResult(null);
    } catch {
      setError("Не получилось начать. Проверьте интернет и попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  }

  async function answer(exercise: Exercise, value: string) {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await routerClient.student.vocabulary.answer.mutate({ wordId: exercise.wordId, type: exercise.type, answer: value, extra: session.extra }));
    } catch {
      setError("Не получилось проверить. Проверьте интернет и попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  }

  async function next() {
    if (!session) return;
    setResult(null);
    if (session.index + 1 < session.exercises.length) {
      setSession({ ...session, index: session.index + 1 });
      return;
    }
    setSession(null);
    try {
      setDue((await routerClient.student.vocabulary.dueToday.query()).count);
    } catch {
      setDue(0);
    }
  }

  const exercise = session?.exercises[session.index];
  return (
    <section aria-label="Тренировка" className="flex flex-col gap-4 rounded-task border border-border bg-accent-50 p-5">
      {exercise ? (
        <>
          <span className="text-small text-accent-900">
            {session!.index + 1} / {session!.exercises.length}
          </span>
          <h2 className="text-task-title font-bold text-accent-900">{QUESTION[exercise.type](exercise.prompt)}</h2>
          <ExerciseBody key={`${session!.index}:${exercise.wordId}`} exercise={exercise} disabled={busy || result !== null} onAnswer={(value) => answer(exercise, value)} />
          {result && (
            <>
              <p role="status" className={`text-answer font-semibold ${result.right ? "text-accent-900" : "text-danger"}`}>
                {result.right ? "Верно!" : `Неверно. Правильно: ${result.correct}`}
              </p>
              <button type="button" className={primary} onClick={() => void next()}>
                Дальше
              </button>
            </>
          )}
        </>
      ) : due > 0 ? (
        <>
          <p className="text-answer font-semibold text-accent-900">Слов на сегодня: {due}</p>
          <button type="button" className={primary} disabled={busy} onClick={() => void start(false)}>
            Начать
          </button>
        </>
      ) : (
        <>
          <p className="text-answer font-semibold text-accent-900">На сегодня всё</p>
          <p className="text-small text-accent-900">Завтра будут новые повторения</p>
          <button type="button" className={`${big} border-2 border-border bg-bg text-text`} disabled={busy} onClick={() => void start(true)}>
            Ещё разок
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

function ExerciseBody({ exercise, disabled, onAnswer }: { exercise: Exercise; disabled: boolean; onAnswer: (value: string) => void }) {
  const id = useId();
  const [typed, setTyped] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  if (exercise.options) {
    return (
      <div role="group" aria-label="Варианты" className="grid grid-cols-2 gap-3">
        {exercise.options.map((option) => (
          <button
            key={option}
            type="button"
            disabled={disabled}
            aria-pressed={chosen === option}
            onClick={() => {
              setChosen(option);
              onAnswer(option);
            }}
            className={tile}
          >
            {option}
          </button>
        ))}
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (typed.trim() !== "") onAnswer(typed);
      }}
    >
      <label htmlFor={id} className="text-small text-accent-900">
        Слово
      </label>
      <input
        id={id}
        value={typed}
        disabled={disabled}
        onChange={(event) => setTyped(event.target.value)}
        autoCapitalize="none"
        autoComplete="off"
        className="h-12 rounded-task border-2 border-border bg-bg px-4 text-answer"
      />
      <button type="submit" className={primary} disabled={disabled || typed.trim() === ""}>
        Проверить
      </button>
    </form>
  );
}
