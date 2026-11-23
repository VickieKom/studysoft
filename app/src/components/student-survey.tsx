"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MAX_TEXT_ANSWER_LENGTH } from "@/domain/survey";
import { routerClient } from "./router-client";

type Question = { text: string; choices: string[]; textAnswer: boolean };

const choice = "rounded-task border border-border px-4 py-3 text-answer font-semibold text-accent-900 aria-pressed:bg-accent-100 aria-pressed:border-accent-600";

/**
 * «Опрос про уроки» (#332), before the homework: what was more fun, what the
 * child wants more of and how clear a topic is, in a neutral voice from the
 * platform. Any question may be left unanswered; «Пропустить» skips it all.
 * It counts for nothing. Once answered or skipped, the homework comes.
 */
export function StudentSurvey({ homeworkId, questions }: { homeworkId: string; questions: Question[] }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<(string | null)[]>(() => questions.map(() => null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (index: number, value: string | null) => setAnswers((current) => current.map((a, i) => (i === index ? value : a)));

  async function finish(skip: boolean) {
    setBusy(true);
    setError(null);
    try {
      await routerClient.student.homework.answerSurvey.mutate({ homeworkId, answers: skip ? null : answers });
      router.refresh();
    } catch (cause) {
      const code = (cause as { data?: { code?: string } } | null)?.data?.code;
      // Taken back or answered elsewhere: the page shows what is current.
      if (code === "NOT_FOUND") router.refresh();
      else setError("Не получилось отправить. Проверьте интернет и попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Опрос про уроки" className="flex flex-col gap-5 rounded-task border border-border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-task-title font-bold">Пара вопросов про уроки</h2>
        <p className="text-text-secondary">Отвечай как есть — это не оценка. Можно пропустить</p>
      </div>
      {questions.map((question, index) => (
        <div key={index} role="group" aria-label={question.text} className="flex flex-col gap-2">
          <p className="text-answer font-bold">{question.text}</p>
          {question.textAnswer ? (
            <textarea
              value={answers[index] ?? ""}
              maxLength={MAX_TEXT_ANSWER_LENGTH}
              onChange={(event) => set(index, event.target.value || null)}
              rows={2}
              className="rounded-task border border-border px-3 py-2 text-answer"
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              {question.choices.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={answers[index] === c}
                  onClick={() => set(index, answers[index] === c ? null : c)}
                  className={choice}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      {error && (
        <p role="alert" className="rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy} onClick={() => void finish(false)} className="h-12 rounded-task bg-accent-600 px-6 text-answer font-semibold text-on-accent disabled:opacity-60">
          Готово
        </button>
        <button type="button" disabled={busy} onClick={() => void finish(true)} className="text-small text-text-secondary">
          Пропустить
        </button>
      </div>
    </section>
  );
}
