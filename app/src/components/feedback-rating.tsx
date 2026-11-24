"use client";

import { useState } from "react";
import { type RatingPeriod } from "@/domain/feedback-rating";
import { emptyRating, FeedbackRatingLists, type FeedbackRatingView } from "./student-feedback";

const PERIOD_LABELS: Record<RatingPeriod, string> = { all: "За всё время", month: "За месяц" };

/**
 * «Что заходит» beside «Фидбэк» (#333): the two ratings and the topics,
 * «Игры — 3 из 3», the most chosen first; nothing before any answer. All time
 * by default; «За месяц» shows the answers of the last 30 days only (#377).
 */
export function FeedbackRating({ ratings }: { ratings: Record<RatingPeriod, FeedbackRatingView> }) {
  const [period, setPeriod] = useState<RatingPeriod>("all");
  if (emptyRating(ratings.all)) return null;
  const rating = ratings[period];
  return (
    <section aria-label="Что заходит" className="mt-6 flex flex-col gap-2 rounded-card border border-border p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-h3 font-semibold">Что заходит</h2>
        <div role="group" aria-label="Период" className="flex gap-1 text-small">
          {(Object.keys(PERIOD_LABELS) as RatingPeriod[]).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={period === p}
              onClick={() => setPeriod(p)}
              className={`h-8 rounded-control border px-3 ${period === p ? "border-green-600 bg-green-50 font-semibold" : "border-border hover:bg-surface"}`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>
      {emptyRating(rating) ? <p className="text-small text-text-secondary">За месяц ответов нет</p> : <FeedbackRatingLists rating={rating} />}
    </section>
  );
}
