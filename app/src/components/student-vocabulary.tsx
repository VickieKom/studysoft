import { dayMonthIn } from "@/domain/schedule";

/**
 * «Словарь» on the student card (#154): the words added when lessons were
 * finished — the book lesson's and those the teacher noted on the panel —
 * newest first, each with its translation if any and the day it was added.
 * The student does not see it yet.
 */
export function StudentVocabulary({
  words,
  timeZone,
}: {
  words: { word: string; translation: string | null; addedAt: string }[];
  timeZone: string;
}) {
  return (
    <section aria-labelledby="vocabulary-heading" className="mt-6 rounded-card border border-border p-6">
      <h2 id="vocabulary-heading" className="mb-4 text-h3 font-semibold">
        Словарь
      </h2>
      {words.length === 0 ? (
        <p className="text-small text-text-secondary">Слова появятся после «Завершить урок»</p>
      ) : (
        <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {words.map((w) => (
            <li key={w.word} className="flex flex-wrap gap-x-2 text-small">
              <span className="font-semibold">{w.word}</span>
              {w.translation && <span>— {w.translation}</span>}
              <span className="text-text-secondary">· {dayMonthIn(new Date(w.addedAt), timeZone)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
