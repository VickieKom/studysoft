"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "./button";
import { routerClient } from "./router-client";

const markClass = (on: boolean) =>
  `inline-flex h-9 items-center rounded-control border px-3 text-small font-semibold disabled:opacity-60 ${
    on ? "border-accent-600 bg-accent-100 text-accent-900" : "border-border hover:bg-surface"
  }`;

/** «Верно» / «Неверно» on a task; for an auto-checked task it overrides the platform (#36). */
export function ReviewMark({
  submissionId,
  taskIndex,
  verdict,
}: {
  submissionId: string;
  taskIndex: number;
  verdict: boolean | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function mark(value: boolean) {
    setPending(true);
    setFailed(false);
    try {
      await routerClient.teacher.review.mark.mutate({ id: submissionId, taskIndex, mark: value });
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button type="button" aria-pressed={verdict === true} disabled={pending} onClick={() => mark(true)} className={markClass(verdict === true)}>
        Верно
      </button>
      <button
        type="button"
        aria-pressed={verdict === false}
        disabled={pending}
        onClick={() => mark(false)}
        className={markClass(verdict === false)}
      >
        Неверно
      </button>
      {failed && (
        <span role="alert" className="text-small text-danger">
          Не получилось сохранить оценку
        </span>
      )}
    </div>
  );
}

/** The teacher's one comment on the homework (#36). */
export function ReviewComment({ submissionId, comment }: { submissionId: string; comment: string }) {
  const [value, setValue] = useState(comment);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("saving");
    try {
      await routerClient.teacher.review.comment.mutate({ id: submissionId, comment: value });
      setState("saved");
    } catch {
      setState("failed");
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <label htmlFor="review-comment" className="text-small text-text-secondary">
        Комментарий к домашке
      </label>
      <textarea
        id="review-comment"
        rows={3}
        maxLength={4000}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setState("idle");
        }}
        className="rounded-control border border-border bg-bg px-3 py-2"
      />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={state === "saving"}>
          Сохранить комментарий
        </Button>
        <span role="status" className="text-small text-text-secondary">
          {state === "saved" && "Комментарий сохранён"}
          {state === "failed" && "Не получилось сохранить комментарий"}
        </span>
      </div>
    </form>
  );
}

/** «Открыть заново для ученика»: the submission stays in the history; the student starts a blank attempt (#36). */
export function ReviewReopen({ submissionId }: { submissionId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "pending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function reopen() {
    setState("pending");
    setError(null);
    try {
      await routerClient.teacher.review.reopen.mutate({ id: submissionId });
      setState("done");
      router.refresh();
    } catch (cause) {
      const code = (cause as { data?: { code?: string } } | null)?.data?.code;
      setError(
        code === "PRECONDITION_FAILED" && cause instanceof Error ? cause.message : "Не получилось открыть заново",
      );
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <p role="status" className="text-text-secondary">
        Открыта заново: ученик пройдёт домашку ещё раз
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Button variant="secondary" className="self-start" disabled={state === "pending"} onClick={reopen}>
        Открыть заново для ученика
      </Button>
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
