import { answerKey, homeworkAudioUrl, homeworkImageUrl, TASK_TYPE_LABELS } from "@/domain/homework";
import type { Task } from "@/domain/homework-format";
import { GapChoices } from "./gap-choices";
import { TaskExampleLine, TaskPassage } from "./task-parts";

/**
 * One task as the teacher previews it, key included (#32). Used by the
 * read-only preview and by the draft editor (#37). Never on a student page.
 */
export function HomeworkTaskPreview({ task, number, homeworkId }: { task: Task; number: number; homeworkId: string }) {
  const key = answerKey(task);
  return (
    <>
      <p className="text-caption text-text-muted">
        {number}. {TASK_TYPE_LABELS[task.type]}
      </p>
      <p className="mt-1 whitespace-pre-line font-semibold">{task.prompt}</p>
      {task.passage && <TaskPassage passage={task.passage} className="mt-2" />}
      {task.example && <TaskExampleLine example={task.example} className="mt-2" />}
      {task.image && (
        // biome-ignore lint/performance/noImgElement: the image optimiser fetches without the user's session, so a permission-checked file cannot go through it
        // eslint-disable-next-line @next/next/no-img-element -- same reason as above
        <img
          src={homeworkImageUrl(homeworkId, number - 1)}
          alt="Картинка к заданию"
          className="mt-2 max-h-64 rounded-control border border-border"
        />
      )}
      {task.audio && (
        <audio controls preload="metadata" src={homeworkAudioUrl(homeworkId, number - 1)} className="mt-2 w-full" />
      )}
      {"text" in task && <p className="mt-2 whitespace-pre-line">{task.text}</p>}
      {task.type === "gap" && task.choices && <GapChoices choices={task.choices} className="mt-2 text-small" />}
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
