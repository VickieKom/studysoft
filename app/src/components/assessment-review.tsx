"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { type AssessmentSkill, sectionLabel } from "@/domain/assessment-format";
import {
  CRITERIA,
  CRITERIA_SECTIONS,
  CRITERION_LABELS,
  CRITERION_SCORE_LABELS,
  CRITERION_SCORES,
  type CriteriaScores,
  type CriteriaSection,
  criteriaUnsaved,
} from "@/domain/assessment-review";
import { Button } from "./button";
import { routerClient } from "./router-client";

export type AssessmentReviewView = {
  writing: string | null;
  criteria: CriteriaScores;
  percents: { skill: AssessmentSkill; percent: number }[];
  complete: boolean;
  written: boolean;
};

/** A procedure's own message for a refusal the teacher can act on, else a general one. */
function message(cause: unknown): string {
  const code = (cause as { data?: { code?: string } } | null)?.data?.code;
  return (code === "BAD_REQUEST" || code === "CONFLICT") && cause instanceof Error ? cause.message : "Не получилось сохранить. Проверьте интернет и попробуйте ещё раз";
}

/**
 * «Проверка» of an ended assessment (#254): the child's text, «Письмо» and
 * «Говорение» scored by «Решение задачи», «Связность» and «Язык», 0–2 each,
 * the percent of each skill, and «Записать в прогресс» once both are scored.
 * Written, the scores no longer change: they are corrected in «Прогресс».
 */
export function AssessmentReview({
  assessmentId,
  skills,
  speakingRecording,
  review,
}: {
  assessmentId: string;
  skills: AssessmentSkill[];
  speakingRecording: string | null;
  review: AssessmentReviewView;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sections whose picked scores are not saved: «Записать в прогресс» would write the saved ones, so it waits.
  const [unsaved, setUnsaved] = useState<CriteriaSection[]>([]);

  async function write() {
    setBusy(true);
    setError(null);
    try {
      await routerClient.teacher.assessments.writeToProgress.mutate({ assessmentId });
      router.refresh();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Проверка" className="flex flex-col gap-4 border-t border-border pt-3">
      <h3 className="font-semibold">Проверка</h3>
      {CRITERIA_SECTIONS.filter((section) => skills.includes(section)).map((section) => (
        <SectionScore
          key={section}
          assessmentId={assessmentId}
          section={section}
          saved={review.criteria[section] ?? null}
          frozen={review.written}
          onSaved={() => router.refresh()}
          onUnsaved={(changed) => setUnsaved((list) => (changed ? [...list.filter((s) => s !== section), section] : list.filter((s) => s !== section)))}
        >
          {section === "writing" &&
            (review.writing ? <p className="whitespace-pre-line rounded-control bg-surface p-3 text-small">{review.writing}</p> : <p className="text-small text-text-secondary">Ребёнок ничего не написал</p>)}
          {section === "speaking" &&
            (speakingRecording ? (
              <audio controls preload="none" src={speakingRecording} aria-label="Запись говорения для проверки" />
            ) : (
              <p className="text-small text-text-secondary">Записи говорения нет</p>
            ))}
        </SectionScore>
      ))}
      {review.percents.length > 0 && (
        <div className="flex flex-col gap-1">
          <h4 className="text-small font-semibold">Результаты по навыкам</h4>
          <ul aria-label="Результаты по навыкам" className="flex flex-col gap-1 text-small">
            {review.percents.map((p) => (
              <li key={p.skill}>
                {sectionLabel(p.skill)} — {p.percent}%
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}
      {review.written ? (
        <p className="text-small text-accent-900">Записано в прогресс</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy || !review.complete || unsaved.length > 0} onClick={() => void write()}>
            Записать в прогресс
          </Button>
          {!review.complete ? (
            <span className="text-small text-text-secondary">Сначала оцените письмо и говорение</span>
          ) : (
            unsaved.length > 0 && <span className="text-small text-text-secondary">Сначала сохраните оценку</span>
          )}
        </div>
      )}
    </section>
  );
}

function SectionScore({
  assessmentId,
  section,
  saved,
  frozen,
  onSaved,
  onUnsaved,
  children,
}: {
  assessmentId: string;
  section: CriteriaSection;
  saved: number[] | null;
  frozen: boolean;
  onSaved: () => void;
  onUnsaved: (changed: boolean) => void;
  children: React.ReactNode;
}) {
  const [picked, setPicked] = useState<(number | null)[]>(saved ?? CRITERIA.map(() => null));
  // The scores the server has, as this page last saved or was given them: what «Записать в прогресс» would write.
  const [stored, setStored] = useState<number[] | null>(saved);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"idle" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const label = sectionLabel(section);

  async function save() {
    if (picked.some((p) => p === null)) return setError("Оцените все три критерия");
    setBusy(true);
    setError(null);
    try {
      await routerClient.teacher.assessments.score.mutate({ assessmentId, section, scores: picked as number[] });
      setState("saved");
      setStored(picked as number[]);
      onUnsaved(false);
      onSaved();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label={label} className="flex flex-col gap-2">
      <h4 className="text-small font-semibold">{label}</h4>
      {children}
      {CRITERIA.map((criterion, i) => (
        <div key={criterion} role="radiogroup" aria-label={CRITERION_LABELS[criterion]} className="flex flex-wrap items-center gap-3 text-small">
          <span className="w-36">{CRITERION_LABELS[criterion]}</span>
          {CRITERION_SCORES.map((score) => (
            <label key={score} className="flex items-center gap-1">
              <input
                type="radio"
                name={`${assessmentId}-${section}-${criterion}`}
                checked={picked[i] === score}
                disabled={frozen || busy}
                onChange={() => {
                  const next = picked.map((p, j) => (j === i ? score : p));
                  setPicked(next);
                  setState("idle");
                  onUnsaved(criteriaUnsaved(next, stored));
                }}
              />
              {CRITERION_SCORE_LABELS[score]}
            </label>
          ))}
        </div>
      ))}
      {error && (
        <p role="alert" className="rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}
      {!frozen && (
        <div className="flex items-center gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => void save()}>
            Сохранить оценку
          </Button>
          {state === "saved" && <span className="text-small text-accent-900">Оценка сохранена</span>}
        </div>
      )}
    </section>
  );
}
