"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { BOOK_LABELS, type BookKind } from "@/domain/textbook";
import type { TextbookStructure } from "@/domain/textbook-structure";
import { Button } from "./button";
import { routerClient } from "./router-client";

type Range = { from: string; to: string };
type LessonForm = { id?: string; title: string; pages: Partial<Record<BookKind, Range>>; tracks: string; words: string };
type UnitForm = { id?: string; title: string; lessons: LessonForm[] };

const field = "rounded-control border border-border bg-bg px-3 py-2";
const blankLesson = (): LessonForm => ({ title: "", pages: {}, tracks: "", words: "" });

function toForm(structure: TextbookStructure): UnitForm[] {
  return structure.units.map((unit) => ({
    id: unit.id,
    title: unit.title,
    lessons: unit.lessons.map((lesson) => ({
      id: lesson.id,
      title: lesson.title,
      pages: Object.fromEntries(
        Object.entries(lesson.pages).map(([kind, range]) => [kind, { from: String(range!.from), to: String(range!.to) }]),
      ),
      tracks: lesson.tracks.join(", "),
      words: lesson.words.join("\n"),
    })),
  }));
}

/** The form as the structure the platform checks; empty fields are left out, so the server names what is missing. */
function fromForm(units: UnitForm[]): unknown {
  const list = (value: string, separator: RegExp) =>
    value
      .split(separator)
      .map((item) => item.trim())
      .filter((item) => item !== "");
  return {
    units: units.map((unit) => ({
      ...(unit.id ? { id: unit.id } : {}),
      title: unit.title,
      lessons: unit.lessons.map((lesson) => ({
        ...(lesson.id ? { id: lesson.id } : {}),
        title: lesson.title,
        pages: Object.fromEntries(
          Object.entries(lesson.pages)
            .filter(([, range]) => range && (range.from.trim() !== "" || range.to.trim() !== ""))
            .map(([kind, range]) => [kind, { from: Number(range!.from || range!.to), to: Number(range!.to || range!.from) }]),
        ),
        tracks: list(lesson.tracks, /,/),
        words: list(lesson.words, /\n/),
      })),
    })),
  };
}

/**
 * A textbook's units and lessons in plain fields (#150): the draft — the
 * assistant's or the teacher's own — or the confirmed structure to change,
 * or an empty one to fill by hand. «Сохранить черновик» keeps her edits;
 * «Подтвердить» makes them the structure lessons use.
 */
export function TextbookStructureEditor({
  textbookId,
  start,
  open,
  revision,
  books,
}: {
  textbookId: string;
  /** What the form starts from: the draft, else the confirmed structure; null when there is neither. */
  start: TextbookStructure | null;
  /** Open at once: there is a draft to finish. Else a button opens it. */
  open: boolean;
  /** The draft's revision as loaded: a draft replaced meanwhile is a conflict. */
  revision: string;
  books: BookKind[];
}) {
  const router = useRouter();
  const id = useId();
  const [units, setUnits] = useState<UnitForm[] | null>(open && start ? toForm(start) : null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!units) {
    return (
      <Button
        variant="secondary"
        className="self-start"
        onClick={() => setUnits(start ? toForm(start) : [{ title: "", lessons: [blankLesson()] }])}
      >
        {start ? "Изменить" : "Разметить вручную"}
      </Button>
    );
  }

  const setUnit = (u: number, next: Partial<UnitForm>) => setUnits(units.map((unit, i) => (i === u ? { ...unit, ...next } : unit)));
  const setLesson = (u: number, l: number, next: Partial<LessonForm>) =>
    setUnit(u, { lessons: units[u]!.lessons.map((lesson, i) => (i === l ? { ...lesson, ...next } : lesson)) });

  async function save(confirm: boolean) {
    setPending(true);
    setError(null);
    try {
      await routerClient.teacher.textbooks.saveStructure.mutate({ id: textbookId, structure: fromForm(units!), revision, confirm });
      router.refresh();
    } catch (caught) {
      const code = (caught as { data?: { code?: string } })?.data?.code;
      const message = (caught as { message?: string })?.message;
      setError((code === "BAD_REQUEST" || code === "CONFLICT") && message ? message : "Не получилось сохранить. Попробуйте ещё раз");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {units.map((unit, u) => (
        <fieldset key={u} role="group" aria-label={`Юнит ${u + 1}`} className="flex flex-col gap-3 rounded-card border border-border p-4">
          <label className="flex flex-col gap-1">
            <span className="text-small text-text-secondary">Название юнита</span>
            <input value={unit.title} onChange={(e) => setUnit(u, { title: e.target.value })} className={field} />
          </label>
          {unit.lessons.map((lesson, l) => (
            <div key={l} role="group" aria-label={`Урок ${l + 1}`} className="flex flex-col gap-2 rounded-control bg-surface p-3">
              <label className="flex flex-col gap-1">
                <span className="text-small text-text-secondary">Название урока</span>
                <input value={lesson.title} onChange={(e) => setLesson(u, l, { title: e.target.value })} className={field} />
              </label>
              {books.map((kind) => (
                <div key={kind} className="flex flex-wrap items-end gap-2">
                  {(["from", "to"] as const).map((end) => (
                    <label key={end} className="flex flex-col gap-1">
                      <span className="text-small text-text-secondary">
                        {BOOK_LABELS[kind]} {end === "from" ? "с" : "по"}
                      </span>
                      <input
                        type="number"
                        min={1}
                        inputMode="numeric"
                        value={lesson.pages[kind]?.[end] ?? ""}
                        onChange={(e) =>
                          setLesson(u, l, {
                            pages: { ...lesson.pages, [kind]: { from: "", to: "", ...lesson.pages[kind], [end]: e.target.value } },
                          })
                        }
                        className={`${field} w-24`}
                      />
                    </label>
                  ))}
                </div>
              ))}
              <label className="flex flex-col gap-1">
                <span className="text-small text-text-secondary">Треки</span>
                <input
                  value={lesson.tracks}
                  onChange={(e) => setLesson(u, l, { tracks: e.target.value })}
                  placeholder="через запятую: 1-01, 1-02"
                  className={field}
                />
              </label>
              <label className="flex flex-col gap-1" htmlFor={`${id}-${u}-${l}-words`}>
                <span className="text-small text-text-secondary">Слова</span>
                <textarea
                  id={`${id}-${u}-${l}-words`}
                  rows={2}
                  value={lesson.words}
                  onChange={(e) => setLesson(u, l, { words: e.target.value })}
                  placeholder="по одному на строку"
                  className={field}
                />
              </label>
              {unit.lessons.length > 1 && (
                <button
                  type="button"
                  onClick={() => setUnit(u, { lessons: unit.lessons.filter((_, i) => i !== l) })}
                  className="self-start text-small text-text-secondary underline"
                >
                  Удалить урок
                </button>
              )}
            </div>
          ))}
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => setUnit(u, { lessons: [...unit.lessons, blankLesson()] })}>
              Добавить урок
            </Button>
            {units.length > 1 && (
              <button
                type="button"
                onClick={() => setUnits(units.filter((_, i) => i !== u))}
                className="text-small text-text-secondary underline"
              >
                Удалить юнит
              </button>
            )}
          </div>
        </fieldset>
      ))}
      <Button variant="secondary" className="self-start" onClick={() => setUnits([...units, { title: "", lessons: [blankLesson()] }])}>
        Добавить юнит
      </Button>
      {error && (
        <p role="alert" className="whitespace-pre-line rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button disabled={pending} onClick={() => save(true)}>
          Подтвердить
        </Button>
        <Button variant="secondary" disabled={pending} onClick={() => save(false)}>
          Сохранить черновик
        </Button>
      </div>
    </div>
  );
}
