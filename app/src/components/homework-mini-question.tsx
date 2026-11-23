"use client";

import { useState } from "react";
import { ALL_KINDS_ANSWER, ALL_KINDS_LABEL, CHILD_TASK_KIND_LABELS } from "@/domain/homework";
import type { TaskType } from "@/domain/homework-format";
import { routerClient } from "./router-client";

const QUESTION = "Какое задание было самым интересным?";
const choice = "rounded-task border border-border bg-bg px-4 py-3 text-answer font-semibold text-accent-900 disabled:opacity-60";

/**
 * «Мини-вопрос после домашки» (#331), under the praise after «Сдать»: the
 * kinds of the homework's tasks in the child's words and «Все классные», or
 * «Пропустить». Asked in a neutral voice, from the platform; it counts for
 * nothing. A pick that does not reach the server is let go: the question is
 * not worth an error to the child.
 */
export function HomeworkMiniQuestion({ homeworkId, kinds }: { homeworkId: string; kinds: TaskType[] }) {
  const [state, setState] = useState<"asking" | "sending" | "thanked" | "skipped">("asking");

  async function answer(picked: TaskType | typeof ALL_KINDS_ANSWER | null) {
    setState("sending");
    await routerClient.student.homework.answerMiniQuestion.mutate({ id: homeworkId, answer: picked }).catch(() => undefined);
    setState(picked === null ? "skipped" : "thanked");
  }

  if (state === "skipped") return null;
  if (state === "thanked") return <p className="text-answer font-semibold text-accent-900">Спасибо!</p>;
  return (
    <section aria-label={QUESTION} className="flex flex-col gap-3 rounded-task border border-border p-4 text-left">
      <h2 className="text-answer font-bold">{QUESTION}</h2>
      <div className="flex flex-wrap gap-2">
        {kinds.map((kind) => (
          <button key={kind} type="button" disabled={state === "sending"} onClick={() => answer(kind)} className={choice}>
            {CHILD_TASK_KIND_LABELS[kind]}
          </button>
        ))}
        <button type="button" disabled={state === "sending"} onClick={() => answer(ALL_KINDS_ANSWER)} className={choice}>
          {ALL_KINDS_LABEL}
        </button>
      </div>
      <button type="button" disabled={state === "sending"} onClick={() => answer(null)} className="self-start text-small text-text-secondary">
        Пропустить
      </button>
    </section>
  );
}
