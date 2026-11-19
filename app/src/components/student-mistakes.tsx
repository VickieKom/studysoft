import { dayMonthIn } from "@/domain/schedule";

type Topic = {
  topic: string;
  count: number;
  mistakes: { from: "homework" | "game" | "lesson_game"; title: string; at: string; task: string; answer: string | null }[];
};

const FROM_LABELS = { homework: "Домашка", game: "Игра", lesson_game: "Игра на уроке" } as const;

/**
 * «Ошибки по темам» on the student card (#119): the wrong answers of homework
 * and games over the last 30 days, the topic with the most first, each
 * mistake with the student's answer, where it came from and when.
 */
export function StudentMistakes({ topics, timeZone }: { topics: Topic[]; timeZone: string }) {
  return (
    <section aria-labelledby="mistakes-heading" className="mt-6 rounded-card border border-border p-6">
      <h2 id="mistakes-heading" className="mb-4 text-h3 font-semibold">
        Ошибки по темам
      </h2>
      {topics.length === 0 ? (
        <p className="text-small text-text-secondary">За последние 30 дней ошибок нет</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {topics.map((topic) => (
            <li key={topic.topic} className="flex flex-col gap-1">
              <p className="font-semibold">
                <span>{topic.topic}</span> <span className="text-text-secondary">— {topic.count}</span>
              </p>
              <ul className="flex flex-col gap-1">
                {topic.mistakes.map((mistake, index) => (
                  <li key={index} className="flex flex-wrap gap-x-2 text-small">
                    <span className="whitespace-pre-line">{mistake.task}</span>
                    <span>→ {mistake.answer === null ? "без ответа" : `«${mistake.answer}»`}</span>
                    <span className="text-text-secondary">
                      · {FROM_LABELS[mistake.from]}: {mistake.title} · {dayMonthIn(new Date(mistake.at), timeZone)}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
