import { ALL_KINDS_ANSWER, ALL_KINDS_LABEL, CHILD_TASK_KIND_LABELS } from "@/domain/homework";
import type { TaskType } from "@/domain/homework-format";
import { dayMonthIn } from "@/domain/schedule";

type Entry = { homeworkTitle: string; answer: TaskType | typeof ALL_KINDS_ANSWER; answeredAt: string };

/**
 * «Фидбэк» on the student card (#331): what the child picked as the most
 * interesting kind of task after a homework, with the homework and the
 * date, in the child's words. The teacher's only.
 */
export function StudentFeedback({ entries, timeZone }: { entries: Entry[]; timeZone: string }) {
  return (
    <section aria-label="Фидбэк" className="mt-6 flex flex-col gap-2 rounded-card border border-border p-6">
      <h2 className="text-h3 font-semibold">Фидбэк</h2>
      {entries.length === 0 ? (
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
