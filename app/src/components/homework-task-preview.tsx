import { answerKey, homeworkAudioUrl, homeworkImageUrl, homeworkPictureUrl, TASK_TYPE_LABELS } from "@/domain/homework";
import { type ChoiceOption, type Task, withPartPictures } from "@/domain/homework-format";
import { ChoiceOptionContent, hasPictureOptions } from "./choice-option";

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
      {"options" in task && task.options && (
        <PreviewOptions options={withPartPictures(task, (_, n) => homeworkPictureUrl(homeworkId, number - 1, n)).options ?? []} />
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

/** The options as the student sees them, letters and pictures included (#129); `options` carry the pictures' addresses. */
function PreviewOptions({ options }: { options: ChoiceOption[] }) {
  const lettered = hasPictureOptions(options);
  return (
    <div className="mt-2 flex flex-wrap items-start gap-2">
      {options.map((option, i) => (
        <span key={i} className="rounded-control border border-border px-2 py-1 text-small">
          <ChoiceOptionContent option={option} index={i} lettered={lettered} src={(address) => address} />
        </span>
      ))}
    </div>
  );
}
