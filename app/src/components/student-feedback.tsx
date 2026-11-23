import { Fragment } from "react";
import { ALL_KINDS_ANSWER, ALL_KINDS_LABEL, CHILD_TASK_KIND_LABELS } from "@/domain/homework";
import type { TaskType } from "@/domain/homework-format";
import { dayMonthIn } from "@/domain/schedule";

type Entry = { homeworkTitle: string; answer: TaskType | typeof ALL_KINDS_ANSWER; answeredAt: string };
type Survey = { homeworkTitle: string; answeredAt: string; answers: { question: string; answer: string }[] };

/**
 * «Фидбэк» on the student card (#331): what the child picked as the most
 * interesting kind of task after a homework, with the homework and the
 * date, in the child's words, and the answers of the surveys about the
 * lessons (#332), question by question. The teacher's only.
 */
export function StudentFeedback({ entries, surveys = [], timeZone }: { entries: Entry[]; surveys?: Survey[]; timeZone: string }) {
  return (
    <section aria-label="Фидбэк" className="mt-6 flex flex-col gap-2 rounded-card border border-border p-6">
      <h2 className="text-h3 font-semibold">Фидбэк</h2>
      {surveys.map((survey, i) => (
        <div key={`survey-${i}`} className="flex flex-col gap-1 rounded-control bg-surface p-3 text-small">
          <p>
            <span className="font-semibold">{dayMonthIn(new Date(survey.answeredAt), timeZone)}</span> Опрос по урокам · {survey.homeworkTitle}
          </p>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
            {survey.answers.map((a, n) => (
              <Fragment key={n}>
                <dt className="text-text-secondary">{a.question}</dt>
                <dd>{a.answer}</dd>
              </Fragment>
            ))}
          </dl>
        </div>
      ))}
      {entries.length === 0 && surveys.length === 0 ? (
        <p className="text-small text-text-secondary">Ответов пока нет</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry, i) => (
            <li key={i} className="flex flex-wrap gap-x-3 text-small">
              <span className="font-semibold">{dayMonthIn(new Date(entry.answeredAt), timeZone)}</span>
              <span>{entry.homeworkTitle}</span>
              <span>
                Самое интересное: {entry.answer === ALL_KINDS_ANSWER ? ALL_KINDS_LABEL : CHILD_TASK_KIND_LABELS[entry.answer]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
