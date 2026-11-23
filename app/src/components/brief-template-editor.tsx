"use client";

import { useState } from "react";
import { type BriefQuestion, MAX_BRIEF_OPTIONS, MAX_BRIEF_QUESTIONS, MAX_BRIEF_TEXT } from "@/domain/brief";
import { Button } from "./button";
import { routerClient } from "./router-client";

const field = "h-10 rounded-control border border-border bg-bg px-3";

/**
 * «Бриф вводного» in «Настройки» (#339): the questions the teacher fills in
 * on a request during the intro. It starts from the platform's set; she adds
 * options and questions of her own and removes any; each change is saved at
 * once. «другое» is always there, as the note. «Удобное время» is not part of
 * the template: every brief has it.
 */
export function BriefTemplateEditor({ questions: loaded }: { questions: BriefQuestion[] }) {
  const [questions, setQuestions] = useState(loaded);
  const [newQuestion, setNewQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: BriefQuestion[]) {
    setBusy(true);
    setError(null);
    try {
      await routerClient.teacher.requests.saveBriefTemplate.mutate({ questions: next });
      setQuestions(next);
    } catch {
      setError("Не получилось сохранить. Попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Бриф вводного" className="flex flex-col gap-3 border-t border-border pt-4">
      <h2 className="text-h3 font-semibold">Бриф вводного</h2>
      <p className="text-small text-text-secondary">Вопросы, которые вы заполняете на вводном уроке. «Удобное время» есть в каждом брифе.</p>
      {questions.map((question) => (
        <QuestionEditor
          key={question.id}
          question={question}
          busy={busy}
          onChange={(changed) => save(questions.map((q) => (q.id === changed.id ? changed : q)))}
          onRemove={() => save(questions.filter((q) => q.id !== question.id))}
        />
      ))}
      {questions.length < MAX_BRIEF_QUESTIONS && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-small">
            Новый вопрос
            <input value={newQuestion} maxLength={MAX_BRIEF_TEXT} onChange={(event) => setNewQuestion(event.target.value)} className={field} />
          </label>
          <Button
            variant="secondary"
            disabled={busy || newQuestion.trim() === ""}
            onClick={async () => {
              await save([...questions, { id: crypto.randomUUID(), key: null, text: newQuestion.trim(), options: [] }]);
              setNewQuestion("");
            }}
          >
            Добавить вопрос
          </Button>
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

function QuestionEditor({
  question,
  busy,
  onChange,
  onRemove,
}: {
  question: BriefQuestion;
  busy: boolean;
  onChange: (question: BriefQuestion) => Promise<void>;
  onRemove: () => void;
}) {
  const [option, setOption] = useState("");
  return (
    <div role="group" aria-label={question.text} className="flex flex-col gap-2 rounded-control border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{question.text}</span>
        <Button variant="secondary" disabled={busy} onClick={onRemove}>
          Убрать вопрос
        </Button>
      </div>
      <ul className="flex flex-wrap gap-2 text-small">
        {question.options.map((o) => (
          <li key={o} className="flex items-center gap-1 rounded-full border border-border px-3 py-1">
            {o}
            <button
              type="button"
              aria-label={`Убрать вариант ${o}`}
              disabled={busy}
              onClick={() => onChange({ ...question, options: question.options.filter((x) => x !== o) })}
              className="text-text-secondary"
            >
              ×
            </button>
          </li>
        ))}
        <li className="rounded-full border border-dashed border-border px-3 py-1 text-text-secondary">другое</li>
      </ul>
      {question.options.length < MAX_BRIEF_OPTIONS && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-small">
            Новый вариант
            <input value={option} maxLength={MAX_BRIEF_TEXT} onChange={(event) => setOption(event.target.value)} className={field} />
          </label>
          <Button
            variant="secondary"
            disabled={busy || option.trim() === "" || question.options.includes(option.trim())}
            onClick={async () => {
              await onChange({ ...question, options: [...question.options, option.trim()] });
              setOption("");
            }}
          >
            Добавить вариант
          </Button>
        </div>
      )}
    </div>
  );
}
