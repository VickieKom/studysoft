import { formatPastDate } from "@/domain/homework";
import { dateIn } from "@/domain/schedule";

type Stage = { kind: string; title: string | null; skip?: string };

export type PreviousLessonData = {
  date: string;
  status: "held" | "missed";
  bookLesson: string | null;
  stages: Stage[];
  note: string | null;
};

const STAGE_KINDS: Record<string, string> = {
  book: "Учебник",
  warmup: "Разминка",
  game: "Игра",
  video: "Видео",
  textbook_video: "Видео учебника",
  homework: "Разбор домашки",
};

/**
 * «Прошлый урок» in the preparation (#426): the student's latest held or
 * missed lesson — its date, the book lesson, the plan's stages and the note —
 * as the assistant reads it (#424).
 */
export function PreviousLesson({ lesson, timeZone }: { lesson: PreviousLessonData; timeZone: string }) {
  return (
    <section aria-labelledby="previous-lesson" className="flex flex-col gap-2 rounded-card border border-border p-4">
      <h2 id="previous-lesson" className="text-h3 font-semibold">
        Прошлый урок
      </h2>
      <p className="text-small text-text-secondary">
        {formatPastDate(dateIn(new Date(lesson.date), timeZone))} · {lesson.status === "held" ? "проведён" : "пропущен"}
        {lesson.bookLesson && ` · ${lesson.bookLesson}`}
      </p>
      {lesson.stages.length > 0 && (
        <ol aria-label="Этапы прошлого урока" className="flex list-decimal flex-col gap-1 pl-5">
          {lesson.stages.map((stage, i) => (
            <li key={i}>
              {STAGE_KINDS[stage.kind] ?? "Материал"}: {stage.title ?? "удалён"}
              {stage.skip && <span className="text-text-secondary"> · пропустить: {stage.skip}</span>}
            </li>
          ))}
        </ol>
      )}
      {lesson.note && <p className="whitespace-pre-line">{lesson.note}</p>}
    </section>
  );
}
