"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { formatDueDate } from "@/domain/homework";
import { Button } from "./button";
import { type DraftSurveyView, HomeworkSurveyBox } from "./homework-survey-box";
import { routerClient } from "./router-client";

type Props = {
  homeworkId: string;
  status: "draft" | "published" | "submitted" | "missed";
  dueDate: string | null;
  /** The version of the draft this page shows; publishing anything newer is refused (#99). */
  revision: string;
  /** «Мини-вопрос после домашки» as the draft has it (#331); sent with «Опубликовать». */
  askFeedback?: boolean;
  /** The draft's tasks are all of one kind: the question would ask nothing. */
  oneKind?: boolean;
  /** «Опрос по урокам» as the draft has it (#332). */
  survey?: DraftSurveyView;
};

/**
 * Publish a draft with a deadline, or take a published homework back (#32).
 * The draft's «Мини-вопрос после домашки» (#331), off by default, is set with
 * the deadline and saved by «Опубликовать».
 */
export function HomeworkPublish({ homeworkId, status, dueDate, revision, askFeedback = false, oneKind = false, survey = null }: Props) {
  const router = useRouter();
  const [date, setDate] = useState("");
  const [ask, setAsk] = useState(askFeedback);
  const [pending, setPending] = useState(false);
  // «Опрос по урокам» saving a change: publishing waits for it (#332).
  const [surveyBusy, setSurveyBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (cause) {
      const code = (cause as { data?: { code?: string } } | null)?.data?.code;
      // The server's message is meant for the teacher only for a wrong deadline and a changed draft.
      setError(
        (code === "BAD_REQUEST" || code === "CONFLICT") && cause instanceof Error
          ? cause.message
          : "Не получилось. Обновите страницу и попробуйте ещё раз",
      );
    } finally {
      setPending(false);
    }
  }

  async function onPublish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!date || surveyBusy) return;
    await run(() => routerClient.teacher.homework.publish.mutate({ id: homeworkId, revision, dueDate: date, askFeedback: ask }));
  }

  if (status === "missed" || status === "submitted") return null;

  return (
    <div className="flex flex-col gap-2">
      {status === "draft" ? (
        <form onSubmit={onPublish} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="homework-due" className="text-small text-text-secondary">
              Срок
            </label>
            <input
              id="homework-due"
              type="date"
              required
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="h-10 rounded-control border border-border px-3"
            />
          </div>
          <Button type="submit" disabled={pending || surveyBusy || !date}>
            Опубликовать
          </Button>
          <div className="flex basis-full flex-col gap-1">
            <label className="flex items-center gap-2 text-small">
              <input type="checkbox" checked={ask} onChange={(event) => setAsk(event.target.checked)} />
              Мини-вопрос после домашки
            </label>
            {ask && (
              <span className="text-caption text-text-secondary">
                {oneKind
                  ? "Все задания одного вида — вопрос не задаётся"
                  : "После «Сдать» ученик выберет, какое задание было самым интересным; на оценку не влияет"}
              </span>
            )}
          </div>
          <HomeworkSurveyBox homeworkId={homeworkId} survey={survey} onBusy={setSurveyBusy} />
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {dueDate && <span>Срок: {formatDueDate(dueDate)}</span>}
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => run(() => routerClient.teacher.homework.unpublish.mutate({ id: homeworkId }))}
          >
            Снять с публикации
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
