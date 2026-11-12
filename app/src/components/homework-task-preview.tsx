import { answerKey, TASK_TYPE_LABELS } from "@/domain/homework";
import type { Task } from "@/domain/homework-format";

/**
 * One task as the teacher previews it, key included (#32). Used by the
 * read-only preview and by the draft editor (#37). Never on a student page.
 */
export function HomeworkTaskPreview({ task, number }: { task: Task; number: number }) {
  const key = answerKey(task);
  return (
    <>
      <p className="text-caption text-text-muted">
        {number}. {TASK_TYPE_LABELS[task.type]}
      </p>
      <p className="mt-1 font-semibold">{task.prompt}</p>
      {"text" in task && <p className="mt-2">{task.text}</p>}
      {"options" in task && task.options && (
        <p className="mt-2 flex flex-wrap gap-2">
          {task.options.map((option, i) => (
            <span key={i} className="rounded-control border border-border px-2 py-1 text-small">
              {option}
            </span>
          ))}
        </p>
      )}
      {"hint" in task && task.hint && <p className="mt-2 text-small text-text-secondary">{task.hint}</p>}
      {key !== null && (
        <p className="mt-2 text-small text-green-700">
          <span className="font-semibold">Ответ:</span> {key}
        </p>
      )}
    </>
  );
}
