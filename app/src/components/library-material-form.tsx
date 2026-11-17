"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useState } from "react";
import { AGE_GROUP_LABELS, AGE_GROUPS, type AgeGroup, MAX_GAME_BYTES } from "@/domain/library";
import { LEVELS, type Level } from "@/domain/student";
import { Button } from "./button";
import { routerClient } from "./router-client";

const field = "h-10 rounded-control border border-border bg-bg px-3";

function Labelled({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-small text-text-secondary">
        {label}
      </label>
      {children}
    </div>
  );
}

type Tags = { title: string; level: Level; topic: string; ageGroup: AgeGroup };

/**
 * «Загрузить» and «Изменить» in «Библиотека» (#115): a game's file, title and
 * tags. A new game goes to the list of games; an edited one back to its page.
 */
export function LibraryMaterialForm({ material }: { material?: Tags & { id: string } }) {
  const router = useRouter();
  const [tags, setTags] = useState<Tags>(material ?? { title: "", level: "A1", topic: "", ageGroup: "younger" });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const set = (next: Partial<Tags>) => setTags((current) => ({ ...current, ...next }));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    if (!material && file && file.size > MAX_GAME_BYTES) return setError("Файл больше 5 МБ");
    setPending(true);
    try {
      if (material) {
        await routerClient.teacher.library.update.mutate({ id: material.id, ...tags });
        router.push(`/teacher/library/${material.id}`);
      } else {
        if (!file) throw new Error("no file");
        await routerClient.teacher.library.addGame.mutate({ ...tags, html: await file.text() });
        router.push("/teacher/library?type=game");
      }
      router.refresh();
    } catch (caught) {
      const message = (caught as { message?: string })?.message;
      const isOwn = (caught as { data?: { code?: string } })?.data?.code === "BAD_REQUEST";
      setError(isOwn && message ? message : "Не получилось сохранить. Попробуйте ещё раз");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-4">
      {!material && (
        <>
          <Labelled id="material-kind" label="Тип материала">
            <select id="material-kind" className={field} defaultValue="game">
              <option value="game">Игра</option>
            </select>
          </Labelled>
          <Labelled id="material-file" label="Файл игры">
            <input
              id="material-file"
              type="file"
              required
              accept=".html,.htm,text/html"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </Labelled>
        </>
      )}
      <Labelled id="material-title" label="Название">
        <input
          id="material-title"
          required
          maxLength={200}
          value={tags.title}
          onChange={(event) => set({ title: event.target.value })}
          className={field}
        />
      </Labelled>
      <Labelled id="material-level" label="Уровень">
        <select
          id="material-level"
          value={tags.level}
          onChange={(event) => set({ level: event.target.value as Level })}
          className={field}
        >
          {LEVELS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </Labelled>
      <Labelled id="material-topic" label="Тема">
        <input
          id="material-topic"
          maxLength={100}
          value={tags.topic}
          onChange={(event) => set({ topic: event.target.value })}
          className={field}
        />
      </Labelled>
      <Labelled id="material-age" label="Возраст">
        <select
          id="material-age"
          value={tags.ageGroup}
          onChange={(event) => set({ ageGroup: event.target.value as AgeGroup })}
          className={field}
        >
          {AGE_GROUPS.map((age) => (
            <option key={age} value={age}>
              {AGE_GROUP_LABELS[age]}
            </option>
          ))}
        </select>
      </Labelled>
      {error && (
        <p role="alert" className="rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          Сохранить
        </Button>
      </div>
    </form>
  );
}
