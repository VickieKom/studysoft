import { exampleParts } from "@/domain/homework";
import type { TaskExample } from "@/domain/homework-format";

/**
 * The parts of a workbook exercise besides its instruction (#131), laid out
 * the same way for the student, in the teacher's preview and in the review:
 * a reading text in regular type with its lines, and an example with its
 * answer in place, marked as an example and never answered.
 */
export function TaskPassage({ passage, className = "" }: { passage: string; className?: string }) {
  return (
    <section aria-label="Текст" className={`whitespace-pre-line rounded-task bg-surface px-4 py-3 font-normal ${className}`}>
      {passage}
    </section>
  );
}

export function TaskExampleLine({ example, className = "" }: { example: TaskExample; className?: string }) {
  const { before, answer, after } = exampleParts(example);
  const inGap = example.text.includes("___");
  return (
    <section aria-label="Пример" className={`flex flex-wrap items-baseline gap-x-2 text-text-secondary ${className}`}>
      <span className="text-small font-semibold uppercase">Пример</span>
      <span className="whitespace-pre-line">
        {before}
        {answer && (inGap ? <u className="font-semibold text-text-primary">{answer}</u> : <> — <span className="font-semibold text-text-primary">{answer}</span></>)}
        {after}
      </span>
    </section>
  );
}
