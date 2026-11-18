import { OPTION_LETTERS } from "@/domain/homework";
import type { ChoiceOption } from "@/domain/homework-format";

/** Whether any option of a task is a picture: then every option gets its letter (#129). */
export function hasPictureOptions(options: ChoiceOption[]): boolean {
  return options.some((option) => typeof option !== "string");
}

/**
 * One answer option (#129): text, or pictures with an optional caption. The
 * letter is drawn here, as a workbook prints it; `src` turns the n-th picture
 * of the task's options into its address.
 */
export function ChoiceOptionContent({
  option,
  index,
  lettered,
  src,
}: {
  option: ChoiceOption;
  index: number;
  lettered: boolean;
  src: (picture: string) => string;
}) {
  const letter = lettered ? (
    <span className="self-start font-bold text-text-secondary">{OPTION_LETTERS[index]}</span>
  ) : null;
  if (typeof option === "string") {
    return lettered ? (
      <span className="flex items-start gap-2 text-left">
        {letter}
        <span>{option}</span>
      </span>
    ) : (
      option
    );
  }
  return (
    <span className="flex items-start gap-2 text-left">
      {letter}
      <span className="flex flex-col items-center gap-2">
        <span className="flex flex-wrap justify-center gap-2">
          {option.images.map((picture, n) => (
            // eslint-disable-next-line @next/next/no-img-element -- served with a permission check, not by the image optimizer
            <img key={n} src={src(picture)} alt={`Картинка ${n + 1}`} className="max-h-40 max-w-full rounded-control" />
          ))}
        </span>
        {option.text && <span>{option.text}</span>}
      </span>
    </span>
  );
}

/**
 * The pictures on the left of a match pair (#184), with the caption when it
 * has one; «картинка N», the name of a picture without one, is its alt text.
 */
export function MatchPictures({ images, pair, label }: { images: string[]; pair: number; label: string }) {
  const caption = label === `картинка ${pair}` ? null : label;
  return (
    <span className="flex flex-col items-center gap-2">
      <span className="flex flex-wrap justify-center gap-2">
        {images.map((src, n) => (
          // eslint-disable-next-line @next/next/no-img-element -- served with a permission check, not by the image optimizer
          <img key={n} src={src} alt={n === 0 ? `Картинка ${pair}` : `Картинка ${pair}, ${n + 1}`} className="max-h-32 max-w-full rounded-control" />
        ))}
      </span>
      {caption && <span>{caption}</span>}
    </span>
  );
}
