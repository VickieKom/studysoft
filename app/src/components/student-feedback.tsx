import { Fragment } from "react";
import { ALL_KINDS_ANSWER, ALL_KINDS_LABEL, CHILD_TASK_KIND_LABELS } from "@/domain/homework";
import type { TaskType } from "@/domain/homework-format";
import { materialLabel, type Rated, type RatedMaterialKind, ratedLine, taskKindLabel } from "@/domain/feedback-rating";
import { dayMonthIn } from "@/domain/schedule";

/** «Что заходит» (#333) as the card gets it. */
export type FeedbackRatingView = {
  tasks: Rated<TaskType>[];
  materials: Rated<RatedMaterialKind>[];
  topics: { topic: string; chosen: number }[];
};

/**
 * «Что заходит» beside «Фидбэк» (#333): the two ratings and the topics,
 * «Игры — 3 из 3», the most chosen first; nothing before any answer.
 */
export function FeedbackRating({ rating }: { rating: FeedbackRatingView }) {
  if (rating.materials.length + rating.tasks.length + rating.topics.length === 0) return null;
  return (
    <section aria-label="Что заходит" className="mt-6 flex flex-col gap-2 rounded-card border border-border p-6">
      <h2 className="text-h3 font-semibold">Что заходит</h2>
      <FeedbackRatingLists rating={rating} />
    </section>
  );
}

function FeedbackRatingLists({ rating }: { rating: FeedbackRatingView }) {
  const list = (label: string, lines: string[]) =>
    lines.length > 0 && (
      <div className="flex flex-col gap-1">
        <h3 className="font-semibold">{label}</h3>
        <ul aria-label={label} className="flex flex-col gap-1 text-small">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className="flex flex-col gap-3">
      {list("Что заходит на уроках", rating.materials.map((r) => ratedLine(materialLabel(r.key), r)))}
      {list("Что заходит в домашке", rating.tasks.map((r) => ratedLine(taskKindLabel(r.key), r)))}
      {list("Темы, которых хочется ещё", rating.topics.map((t) => `${t.topic} — ${t.chosen}`))}
    </div>
  );
}

type Entry = { homeworkTitle: string; answer: TaskType | typeof ALL_KINDS_ANSWER; answeredAt: string };
type Survey = { homeworkTitle: string; answeredAt: string; answers: { question: string; answer: string }[] };

/**
 * «Фидбэк» on the student card (#331): what the child picked as the most
 * interesting kind of task after a homework, with the homework and the
 * date, in the child's words, and the answers of the surveys about the
 * lessons (#332), question by question. The teacher's only.
 */
export function StudentFeedback({
  entries,
  surveys = [],
  timeZone,
}: {
  entries: Entry[];
  surveys?: Survey[];
  timeZone: string;
}) {
  return (
    <section aria-label="Фидбэк" className="mt-6 flex flex-col gap-2 rounded-card border border-border p-6">
      <h2 className="text-h3 font-semibold">Фидбэк</h2>
      {(entries.length > 0 || surveys.length > 0) && <h3 className="mt-2 font-semibold">Ответы за неделю</h3>}
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
        <ul aria-label="Ответы за неделю" className="flex flex-col gap-2">
          {surveys.map((survey, i) => (
            <li key={`survey-line-${i}`} className="flex flex-wrap gap-x-3 text-small">
              <span className="font-semibold">{dayMonthIn(new Date(survey.answeredAt), timeZone)}</span>
              <span>Опрос по урокам · {survey.homeworkTitle}</span>
            </li>
          ))}
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
