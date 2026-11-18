/** Each gap's own options (#128), as the teacher sees them in the preview and the review: «Пропуск 1: on / at». */
export function GapChoices({ choices, className = "" }: { choices: (string[] | null)[]; className?: string }) {
  return (
    <ul className={`flex flex-col gap-0.5 text-text-secondary ${className}`}>
      {choices.map((own, i) =>
        own ? (
          <li key={i}>
            Пропуск {i + 1}: <span className="text-text-primary">{own.join(" / ")}</span>
          </li>
        ) : null,
      )}
    </ul>
  );
}
