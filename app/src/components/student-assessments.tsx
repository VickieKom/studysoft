"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { ASSESSMENT_STATUS_LABELS, type AssessmentFile, assessmentFileUrl } from "@/domain/assessment";
import { type AssessmentSectionView, type AssessmentSkill, GAP, sectionLabel, TRUE_FALSE, TRUE_FALSE_LABELS } from "@/domain/assessment-format";
import { Button } from "./button";
import { routerClient } from "./router-client";

type Assessment = {
  id: string;
  title: string;
  status: "draft" | "approved";
  /** Saved by the assistant (#313). */
  fromAssistant: boolean;
  sections: AssessmentSectionView[];
  recording: string | null;
  picture: string | null;
  /** The version the page shows, sent back by «Убрать» and «Утвердить» (#313). */
  revision: string;
  /** Taken in a lesson (#253). */
  taking: "not_opened" | "open" | "closed" | "submitted" | "finished";
  speakingRecording: string | null;
};

/** How far the child is, as the teacher reads it on the card (#253). */
const TAKING_LABELS: Record<Assessment["taking"], string | null> = {
  not_opened: null,
  open: "Открыт ученику",
  closed: "Закрыт до следующего урока",
  submitted: "Сдан",
  finished: "Завершён",
};

const field = "rounded-control border border-border bg-bg px-3 py-2";
const failed = "Не получилось сохранить. Проверьте интернет и попробуйте ещё раз";

/** A procedure's own message for a refusal the teacher can act on, else a general one. */
function message(cause: unknown): string {
  const code = (cause as { data?: { code?: string } } | null)?.data?.code;
  return (code === "BAD_REQUEST" || code === "CONFLICT") && cause instanceof Error ? cause.message : failed;
}

/**
 * «Замеры» on the student card (#252): the monthly assessment imported as
 * JSON, shown by section as the child will see it, without keys. On a draft
 * the teacher removes questions, uploads the recording for «Аудирование» and
 * the picture for «Говорение», and approves it; an approved one does not
 * change. While a lesson with the student is going on she opens it to them
 * (#253) and may end it with «Завершить замер»; the speaking recording made
 * on the lesson panel plays here.
 */
export function StudentAssessments({ studentId, assessments }: { studentId: string; assessments: Assessment[] }) {
  const router = useRouter();
  const [importing, setImporting] = useState(false);
  const [json, setJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await routerClient.teacher.assessments.import.mutate({ studentId, json });
      setImporting(false);
      setJson("");
      router.refresh();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Замеры" className="mt-6 rounded-card border border-border p-6">
      <header className="mb-4 flex items-center justify-between">
        <h2 className="text-h3 font-semibold">Замеры</h2>
        {!importing && (
          <Button variant="secondary" onClick={() => setImporting(true)}>
            Импортировать замер
          </Button>
        )}
      </header>
      {importing && (
        <form onSubmit={onImport} className="mb-4 flex flex-col gap-3">
          <label htmlFor="assessment-json" className="text-small text-text-secondary">
            JSON замера
          </label>
          <textarea
            id="assessment-json"
            required
            rows={12}
            value={json}
            onChange={(event) => setJson(event.target.value)}
            className={`${field} font-mono text-small outline-none focus:border-green-500`}
          />
          {error && (
            <p role="alert" className="whitespace-pre-line rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              Импортировать
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setImporting(false)}>
              Отмена
            </Button>
          </div>
        </form>
      )}
      {assessments.length === 0 ? (
        <p className="text-text-secondary">Замеров пока нет</p>
      ) : (
        <div className="flex flex-col gap-6">
          {assessments.map((a) => (
            <AssessmentCard key={a.id} assessment={a} />
          ))}
        </div>
      )}
    </section>
  );
}

function AssessmentCard({ assessment }: { assessment: Assessment }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draft = assessment.status === "draft";
  const takeable = assessment.status === "approved" && assessment.taking !== "submitted" && assessment.taking !== "finished";
  // Handed in, not ended: «Говорение» is still recorded on the lesson panel until «Завершить замер».
  const finishable = assessment.status === "approved" && assessment.taking !== "not_opened" && assessment.taking !== "finished";
  const taking = TAKING_LABELS[assessment.taking];

  async function run(change: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await change();
      router.refresh();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function upload(which: AssessmentFile, file: File) {
    await run(async () => {
      const response = await fetch(assessmentFileUrl(assessment.id, which), { method: "PUT", body: file });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw Object.assign(new Error(body?.error ?? "Не получилось загрузить файл. Попробуйте ещё раз"), { data: { code: "BAD_REQUEST" } });
      }
    });
  }

  const remove = (section: AssessmentSkill, index: number) =>
    run(() => routerClient.teacher.assessments.removeQuestion.mutate({ assessmentId: assessment.id, revision: assessment.revision, section, index }));

  return (
    <div role="group" aria-label={assessment.title} className="flex flex-col gap-4 rounded-card border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">{assessment.title}</p>
        <span className="flex items-center gap-2">
          {assessment.fromAssistant && <span className="text-small text-text-secondary">от ассистента</span>}
          <span className="rounded-full bg-green-50 px-2 py-0.5 text-caption text-green-700">{ASSESSMENT_STATUS_LABELS[assessment.status]}</span>
          {taking && <span className="rounded-full bg-accent-50 px-2 py-0.5 text-caption text-accent-900">{taking}</span>}
        </span>
      </div>
      {assessment.sections.map((section) => (
        <section key={section.skill} aria-label={sectionLabel(section.skill)} className="flex flex-col gap-2 border-t border-border pt-3">
          <h3 className="font-semibold">{sectionLabel(section.skill)}</h3>
          {section.prompt && <p className="whitespace-pre-line text-small text-text-secondary">{section.prompt}</p>}
          {section.skill === "listening" && (
            <MediaControl
              label="Запись для аудирования"
              accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/ogg,.mp3,.m4a,.wav,.ogg"
              editable={draft}
              busy={busy}
              onFile={(file) => void upload("listening", file)}
            >
              {assessment.recording && <audio controls preload="none" src={assessment.recording} aria-label="Запись для аудирования" />}
            </MediaControl>
          )}
          {section.skill === "speaking" && (
            <MediaControl
              label="Картинка для говорения"
              accept="image/png,image/jpeg,image/webp"
              editable={draft}
              busy={busy}
              onFile={(file) => void upload("picture", file)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a stored file behind a permission check, not an optimisable asset */}
              {assessment.picture && <img src={assessment.picture} alt="Картинка для говорения" className="max-h-64 self-start rounded-control" />}
            </MediaControl>
          )}
          {section.skill === "speaking" && assessment.speakingRecording && (
            <audio controls preload="none" src={assessment.speakingRecording} aria-label="Запись говорения" />
          )}
          <SectionBody section={section} />
          {section.questions.length > 0 && (
            <ol className="flex list-decimal flex-col gap-3 pl-5">
              {section.questions.map((question, index) => (
                <li key={index} className="flex flex-col gap-1">
                  <Question question={question} />
                  {draft && section.removable && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void remove(section.skill, index)}
                      className="self-start text-small text-text-secondary hover:text-text"
                    >
                      Убрать
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      ))}
      {error && (
        <p role="alert" className="whitespace-pre-line rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}
      {draft && (
        <div>
          <Button disabled={busy} onClick={() => void run(() => routerClient.teacher.assessments.approve.mutate({ assessmentId: assessment.id, revision: assessment.revision }))}>
            Утвердить
          </Button>
        </div>
      )}
      {(takeable || finishable) && (
        <div className="flex flex-wrap gap-2">
          {takeable && (
            <Button disabled={busy} onClick={() => void run(() => routerClient.teacher.assessments.open.mutate({ assessmentId: assessment.id }))}>
              Открыть ученику
            </Button>
          )}
          {finishable && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void run(() => routerClient.teacher.assessments.finish.mutate({ assessmentId: assessment.id }))}
            >
              Завершить замер
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function MediaControl({
  label,
  accept,
  editable,
  busy,
  onFile,
  children,
}: {
  label: string;
  accept: string;
  editable: boolean;
  busy: boolean;
  onFile: (file: File) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      {editable && (
        <label className="flex flex-col gap-1 text-small">
          <span className="text-text-secondary">{label}</span>
          <input
            type="file"
            accept={accept}
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) onFile(file);
            }}
          />
        </label>
      )}
      {children}
    </div>
  );
}

/** The section's own text: the reading text, the grammar text with each gap's forms, the writing task. */
function SectionBody({ section }: { section: AssessmentSectionView }) {
  if (section.skill === "grammar" && section.text !== null) {
    const parts = section.text.split(GAP);
    return (
      <p className="whitespace-pre-line">
        {parts.map((part, i) => (
          <span key={i}>
            {part}
            {i < parts.length - 1 && <span className="font-semibold"> [{(section.gaps?.[i] ?? []).join(" / ")}] </span>}
          </span>
        ))}
      </p>
    );
  }
  return (
    <>
      {section.text && <p className="whitespace-pre-line">{section.text}</p>}
      {section.task !== null && (
        <>
          <p className="whitespace-pre-line">{section.task}</p>
          <textarea disabled rows={4} aria-label="Ответ ученика" className={field} />
        </>
      )}
    </>
  );
}

/** A question as the child will see it: options to choose, a field to type, nothing of the key. */
function Question({ question }: { question: AssessmentSectionView["questions"][number] }) {
  switch (question.type) {
    case "choice":
      return (
        <>
          <span>{question.question}</span>
          <span className="flex flex-wrap gap-x-4 text-small">
            {question.options.map((option, i) => (
              <span key={i}>
                {String.fromCharCode(97 + i)}) {option}
              </span>
            ))}
          </span>
        </>
      );
    case "true_false":
      return (
        <>
          <span>{question.statement}</span>
          <span className="flex flex-wrap gap-x-4 text-small">
            {TRUE_FALSE.map((value) => (
              <span key={value}>{TRUE_FALSE_LABELS[value]}</span>
            ))}
          </span>
        </>
      );
    case "translation":
      return (
        <span className="flex flex-wrap items-center gap-2">
          {question.translation} — <input disabled aria-label="Слово" className={`${field} h-9 w-40`} />
        </span>
      );
    case "sentence":
      return <span>{question.text.replace(GAP, "_____")}</span>;
    case "open":
      return <span>{question.question}</span>;
  }
}
