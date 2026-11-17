import Link from "next/link";
import { formatPastDate } from "@/domain/homework";

type Past = { id: string; title: string; submittedOn: string; correct: number; wrong: number; unchecked: number };

/** «Прошлые сдачи» on the student card (#38): the history imported from the old tool; shown only when there is some. */
export function PastSubmissions({ submissions }: { submissions: Past[] }) {
  if (submissions.length === 0) return null;
  return (
    <section aria-labelledby="past-heading" className="mt-6 rounded-card border border-border p-6">
      <h2 id="past-heading" className="mb-4 text-h3 font-semibold">
        Прошлые сдачи
      </h2>
      <ul className="divide-y divide-border">
        {submissions.map((item) => (
          <li key={item.id} className="py-3">
            <Link href={`/teacher/homework-review/imported/${item.id}`} className="flex flex-wrap items-center gap-4">
              <span className="flex-1 font-semibold">{item.title}</span>
              <span className="text-small text-text-secondary">{formatPastDate(item.submittedOn)}</span>
              <span className="text-small">
                {item.correct} верно, {item.wrong} неверно
                {item.unchecked > 0 && `, ${item.unchecked} без проверки`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
