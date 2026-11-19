"use client";

import { useState } from "react";
import { Button } from "./button";
import { routerClient } from "./router-client";

type Textbook = { id: string; title: string; lessons: { id: string; label: string }[] };

const field = "rounded-control border border-border bg-bg px-3 py-2 h-10";

/**
 * «Учебник ученика» on the card (#151): the student's textbook among the
 * uploaded ones and the lesson of it passed so far, from which «Подготовка»
 * proposes the next one. The plan of a later held lesson moves it on.
 */
export function StudentTextbook({
  studentId,
  textbookId,
  passedLessonId,
  textbooks,
}: {
  studentId: string;
  textbookId: string | null;
  passedLessonId: string | null;
  textbooks: Textbook[];
}) {
  const [book, setBook] = useState(textbookId ?? "");
  const [passed, setPassed] = useState(passedLessonId ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const lessons = textbooks.find((t) => t.id === book)?.lessons ?? [];

  async function save() {
    setState("saving");
    try {
      await routerClient.teacher.prep.setStudentTextbook.mutate({ studentId, textbookId: book || null, passedLessonId: (book && passed) || null });
      setState("saved");
    } catch {
      setState("failed");
    }
  }

  if (textbooks.length === 0) {
    return <p className="text-small text-text-secondary">Загрузите учебник в «Библиотеке», чтобы выбрать его здесь</p>;
  }
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-small text-text-secondary">Учебник из библиотеки</span>
        <select
          value={book}
          onChange={(e) => {
            setBook(e.target.value);
            setPassed("");
            setState("idle");
          }}
          className={field}
        >
          <option value="">Не выбран</option>
          {textbooks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      </label>
      {book && (
        <label className="flex flex-col gap-1">
          <span className="text-small text-text-secondary">Пройденный урок</span>
          <select
            value={passed}
            onChange={(e) => {
              setPassed(e.target.value);
              setState("idle");
            }}
            className={field}
          >
            <option value="">Ещё ни одного</option>
            {lessons.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <Button variant="secondary" disabled={state === "saving"} onClick={save}>
        Сохранить учебник
      </Button>
      <span role="status" className="text-small text-text-secondary">
        {state === "saved" && "Сохранено"}
        {state === "failed" && "Не получилось сохранить"}
      </span>
    </div>
  );
}
