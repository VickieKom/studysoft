"use client";

import { useState } from "react";
import { MAX_QUESTION_LENGTH } from "@/domain/survey";
import { Button } from "./button";
import { routerClient } from "./router-client";

export type DraftSurveyView = { questions: { text: string }[]; revision: string } | { noLessons: true } | null;

const BOX = "Опрос по урокам";

/**
 * «Опрос по урокам» in a homework draft (#332), off by default: ticked, the
 * questions gathered from the lessons held since the student's previous
 * survey; the teacher removes any and adds her own. Each change is saved at
 * once and opens with the homework on «Опубликовать».
 */
export function HomeworkSurveyBox({ homeworkId, survey: loaded }: { homeworkId: string; survey: DraftSurveyView }) {
  const [survey, setSurvey] = useState<DraftSurveyView>(loaded);
  // The box follows the click at once; the questions follow the server.
  const [on, setOn] = useState(loaded !== null);
  const [own, setOwn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(change: () => Promise<DraftSurveyView>) {
    setBusy(true);
    setError(null);
    try {
      setSurvey(await change());
    } catch (cause) {
      setOn(survey !== null);
      const code = (cause as { data?: { code?: string } } | null)?.data?.code;
      setError((code === "BAD_REQUEST" || code === "CONFLICT") && cause instanceof Error ? cause.message : "Не получилось сохранить. Попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  }

  const questions = on && survey && "questions" in survey ? survey : null;
  return (
    <section aria-label={BOX} className="flex basis-full flex-col gap-2">
      <label className="flex items-center gap-2 text-small">
        <input
          type="checkbox"
          checked={on}
          disabled={busy}
          onChange={(event) => {
            const next = event.target.checked;
            setOn(next);
            void run(() => routerClient.teacher.homework.setSurvey.mutate({ id: homeworkId, on: next }));
          }}
        />
        {BOX}
      </label>
      {on && survey && "noLessons" in survey && <span className="text-caption text-text-secondary">Опрос не собран: уроков за период нет</span>}
      {questions && (
        <div className="flex flex-col gap-2 rounded-control border border-border p-3">
          <ol className="flex flex-col gap-1 text-small">
            {questions.questions.map((q, index) => (
              <li key={index} className="flex flex-wrap items-center justify-between gap-2">
                <span>{q.text}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => routerClient.teacher.homework.editSurvey.mutate({ id: homeworkId, revision: questions.revision, edit: { remove: index } }))}
                  className="text-caption text-text-secondary hover:text-text"
                >
                  Убрать
                </button>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-small">
              Свой вопрос
              <input
                value={own}
                maxLength={MAX_QUESTION_LENGTH}
                onChange={(event) => setOwn(event.target.value)}
                className="h-10 rounded-control border border-border bg-bg px-3"
              />
            </label>
            <Button
              variant="secondary"
              disabled={busy || own.trim() === ""}
              onClick={async () => {
                await run(() => routerClient.teacher.homework.editSurvey.mutate({ id: homeworkId, revision: questions.revision, edit: { add: own } }));
                setOwn("");
              }}
            >
              Добавить вопрос
            </Button>
          </div>
          <span className="text-caption text-text-secondary">Ученик увидит опрос перед домашкой; можно пропустить, на оценку не влияет</span>
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
