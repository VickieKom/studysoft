"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AssessmentAnswers } from "@/domain/assessment-answers";
import { type AssessmentSectionView, type AssessmentSkill, GAP, sectionLabel, TRUE_FALSE, TRUE_FALSE_LABELS } from "@/domain/assessment-format";
import { Button } from "./button";
import { routerClient } from "./router-client";

type ChildAssessment = {
  id: string;
  title: string;
  sections: Omit<AssessmentSectionView, "removable">[];
  answers: AssessmentAnswers;
  listening: { playsLeft: number; url: string | null } | null;
  picture: string | null;
  submitted: boolean;
};

const field = "rounded-control border border-border bg-bg px-3 py-2 text-answer";
/** A typed answer is saved this long after the last keystroke, and at once on «Дальше», «Назад» and «Сдать». */
const TYPING_DELAY_MS = 500;

type Pending = Record<string, { skill: AssessmentSkill; index: number; value: string | null }>;

/**
 * Answers given but not yet confirmed by the server, kept in this browser:
 * a reload or a lost connection right after an answer sends it again when
 * the page opens. Storage may be unavailable; then nothing is kept.
 */
const pendingKey = (id: string) => `studysoft:assessment:${id}`;
function readPending(id: string): Pending {
  try {
    return JSON.parse(localStorage.getItem(pendingKey(id)) ?? "{}") as Pending;
  } catch {
    return {};
  }
}
function writePending(id: string, change: (pending: Pending) => void) {
  try {
    const pending = readPending(id);
    change(pending);
    if (Object.keys(pending).length === 0) localStorage.removeItem(pendingKey(id));
    else localStorage.setItem(pendingKey(id), JSON.stringify(pending));
  } catch {
    // Storage is off: the answer still goes to the server, it is only not kept here.
  }
}

/**
 * The assessment on the child's page (#253): section by section in the
 * format's order, each titled with its skill; «Назад» goes back to change an
 * answer until «Сдать». Each answer is saved as it is given, one after
 * another so a later one never lands first. «Аудирование» plays at most
 * twice, counted on the server. «Говорение» shows the questions to answer
 * the teacher live. «Сдать» ends in praise without a score.
 */
export function AssessmentRunner({ assessment }: { assessment: ChildAssessment }) {
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<AssessmentAnswers>(assessment.answers);
  const [submitted, setSubmitted] = useState(assessment.submitted);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const typing = useRef<Map<string, { timer: ReturnType<typeof setTimeout>; send: () => void }>>(new Map());

  const send = useCallback(
    (skill: AssessmentSkill, index: number, value: string | null) => {
      const key = `${skill}:${index}`;
      queue.current = queue.current
        .then(() => routerClient.student.assessments.answer.mutate({ id: assessment.id, section: skill, index, value }))
        .then(
          () => {
            setError(null);
            // Kept on the server: no longer pending, unless a newer answer to the same question is.
            writePending(assessment.id, (pending) => {
              if (pending[key]?.value === value) delete pending[key];
            });
          },
          () => setError("Не получилось сохранить ответ. Проверьте интернет"),
        );
    },
    [assessment.id],
  );

  // Answers left pending by a reload or a lost connection: shown and sent again.
  useEffect(() => {
    if (assessment.submitted) return;
    const pending = Object.values(readPending(assessment.id));
    if (pending.length === 0) return;
    void Promise.resolve().then(() => {
      setAnswers((before) => pending.reduce((next, { skill, index, value }) => withValue(next, skill, index, value), before));
      for (const { skill, index, value } of pending) send(skill, index, value);
    });
  }, [assessment.id, assessment.submitted, send]);

  /** Sends the typed answers still waiting, then waits for every save. */
  const flush = useCallback(async () => {
    for (const { timer, send: pending } of typing.current.values()) {
      clearTimeout(timer);
      pending();
    }
    typing.current.clear();
    await queue.current;
  }, []);

  function answer(skill: AssessmentSkill, index: number, value: string | null, typed = false) {
    setAnswers((before) => withValue(before, skill, index, value));
    const key = `${skill}:${index}`;
    writePending(assessment.id, (pending) => {
      pending[key] = { skill, index, value };
    });
    const waiting = typing.current.get(key);
    if (waiting) clearTimeout(waiting.timer);
    if (!typed) {
      typing.current.delete(key);
      send(skill, index, value);
      return;
    }
    const pending = () => send(skill, index, value);
    typing.current.set(key, {
      send: pending,
      timer: setTimeout(() => {
        typing.current.delete(key);
        pending();
      }, TYPING_DELAY_MS),
    });
  }

  async function go(to: number) {
    setBusy(true);
    await flush();
    setBusy(false);
    setCurrent(to);
  }

  async function submit() {
    setBusy(true);
    try {
      await flush();
      await routerClient.student.assessments.submit.mutate({ id: assessment.id });
      writePending(assessment.id, (pending) => {
        for (const key of Object.keys(pending)) delete pending[key];
      });
      setSubmitted(true);
    } catch {
      setError("Не получилось сдать. Проверьте интернет и попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-task border border-border bg-accent-50 px-6 py-10 text-center">
        <p className="text-task-title font-bold text-accent-900">Готово!</p>
        <p className="mt-2 text-answer font-semibold text-accent-900">Замер сдан. Молодец!</p>
      </div>
    );
  }

  const section = assessment.sections[current]!;
  const last = current === assessment.sections.length - 1;
  const given = answers[section.skill] ?? [];

  return (
    <div className="flex flex-col gap-6 pb-20">
      <section aria-labelledby="assessment-section" className="flex flex-col gap-4">
        <h2 id="assessment-section" className="text-answer font-bold">
          {sectionLabel(section.skill)}
        </h2>
        {section.prompt && <p className="whitespace-pre-line">{section.prompt}</p>}
        {section.skill === "listening" && assessment.listening && <Listening id={assessment.id} listening={assessment.listening} />}
        {section.skill === "speaking" && assessment.picture && (
          // eslint-disable-next-line @next/next/no-img-element -- a stored file behind a permission check, not an optimisable asset
          <img src={assessment.picture} alt="Картинка" className="max-h-80 self-start rounded-control" />
        )}
        {section.text && section.skill === "reading" && <p className="whitespace-pre-line text-answer">{section.text}</p>}
        {section.skill === "grammar" && section.text && section.gaps && (
          <GrammarText text={section.text} gaps={section.gaps} given={given} onAnswer={(index, value) => answer("grammar", index, value)} />
        )}
        {section.skill === "writing" && (
          <>
            {section.task && <p className="whitespace-pre-line text-answer">{section.task}</p>}
            <label className="flex flex-col gap-1">
              <span className="text-small text-text-secondary">Ответ</span>
              <textarea
                rows={8}
                aria-label="Ответ"
                value={given[0] ?? ""}
                onChange={(event) => answer("writing", 0, event.target.value, true)}
                className={field}
              />
            </label>
          </>
        )}
        {section.questions.length > 0 && (
          <ol className="flex list-decimal flex-col gap-5 pl-5">
            {section.questions.map((question, index) => (
              <li key={index}>
                {question.type === "choice" && (
                  <Choice
                    name={`${section.skill}-${index}`}
                    legend={question.question}
                    options={question.options.map((option, i) => ({ value: String(i), label: option }))}
                    value={given[index] ?? null}
                    onAnswer={(value) => answer(section.skill, index, value)}
                  />
                )}
                {question.type === "true_false" && (
                  <Choice
                    name={`${section.skill}-${index}`}
                    legend={question.statement}
                    options={TRUE_FALSE.map((value) => ({ value, label: TRUE_FALSE_LABELS[value] }))}
                    value={given[index] ?? null}
                    onAnswer={(value) => answer(section.skill, index, value)}
                  />
                )}
                {(question.type === "translation" || question.type === "sentence") && (
                  <label className="flex flex-col gap-1">
                    <span className="text-answer">{question.type === "translation" ? question.translation : question.text}</span>
                    <input
                      aria-label={question.type === "translation" ? question.translation : question.text}
                      value={given[index] ?? ""}
                      onChange={(event) => answer("vocabulary", index, event.target.value, true)}
                      autoComplete="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      className={`${field} max-w-xs`}
                    />
                  </label>
                )}
                {question.type === "open" && <p className="text-answer">{question.question}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>
      {error && (
        <p role="alert" className="rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {current > 0 && (
          <Button variant="secondary" disabled={busy} onClick={() => void go(current - 1)}>
            Назад
          </Button>
        )}
        {last ? (
          <Button disabled={busy} onClick={() => void submit()}>
            Сдать
          </Button>
        ) : (
          <Button disabled={busy} onClick={() => void go(current + 1)}>
            Дальше
          </Button>
        )}
      </div>
    </div>
  );
}

/** The answers with one of them set. */
function withValue(answers: AssessmentAnswers, skill: AssessmentSkill, index: number, value: string | null): AssessmentAnswers {
  const list = [...(answers[skill] ?? [])];
  while (list.length <= index) list.push(null);
  list[index] = value;
  return { ...answers, [skill]: list };
}

function Choice({
  name,
  legend,
  options,
  value,
  onAnswer,
}: {
  name: string;
  legend: string;
  options: { value: string; label: string }[];
  value: string | null;
  onAnswer: (value: string) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-answer">{legend}</legend>
      {options.map((option) => (
        <label key={option.value} className="flex items-center gap-3 rounded-control border border-border px-3 py-2">
          <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onAnswer(option.value)} />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

function GrammarText({
  text,
  gaps,
  given,
  onAnswer,
}: {
  text: string;
  gaps: string[][];
  given: (string | null)[];
  onAnswer: (index: number, value: string | null) => void;
}) {
  const parts = text.split(GAP);
  return (
    <p className="whitespace-pre-line text-answer leading-loose">
      {parts.map((part, index) => (
        <span key={index}>
          {part}
          {index < gaps.length && (
            <select
              aria-label={`Пропуск ${index + 1}`}
              value={given[index] ?? ""}
              onChange={(event) => onAnswer(index, event.target.value === "" ? null : event.target.value)}
              className="mx-1 rounded-control border border-border bg-bg px-2 py-1"
            >
              <option value="">…</option>
              {gaps[index]!.map((option, i) => (
                <option key={i} value={String(i)}>
                  {option}
                </option>
              ))}
            </select>
          )}
        </span>
      ))}
    </p>
  );
}

/** The recording of «Аудирование»: each start uses one of the plays, counted on the server; when none is left the player goes. */
function Listening({ id, listening }: { id: string; listening: { playsLeft: number; url: string | null } }) {
  const [playsLeft, setPlaysLeft] = useState(listening.playsLeft);
  const [playing, setPlaying] = useState(false);
  const counted = useRef(false);
  const audio = useRef<HTMLAudioElement>(null);

  async function onPlay() {
    setPlaying(true);
    if (counted.current) return;
    counted.current = true;
    try {
      setPlaysLeft((await routerClient.student.assessments.play.mutate({ id })).playsLeft);
    } catch {
      audio.current?.pause();
      setPlaysLeft(0);
      setPlaying(false);
    }
  }

  function onEnded() {
    counted.current = false;
    setPlaying(false);
  }

  if (!listening.url || (playsLeft === 0 && !playing)) {
    return <p className="text-small text-text-secondary">Запись прослушана дважды</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <audio ref={audio} controls preload="auto" src={listening.url} aria-label="Запись" onPlay={() => void onPlay()} onEnded={onEnded} />
      <p className="text-small text-text-secondary">Осталось прослушиваний: {playsLeft}</p>
    </div>
  );
}
