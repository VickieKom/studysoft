"use client";

import { useRouter } from "next/navigation";
import { AGE_GROUP_LABELS, AGE_GROUPS } from "@/domain/library";
import { LEVELS } from "@/domain/student";

const field = "h-10 rounded-control border border-border bg-bg px-3";

type Filter = { type?: string; level?: string; topic?: string; age?: string };

/**
 * The level, topic and age filters of «Библиотека» (#115): each choice reloads the list.
 * The address is built from what the selects show now, not from the filter the page was
 * rendered with: a second choice made before the first one's page arrives keeps the first.
 */
export function LibraryFilters({ filter, topics }: { filter: Filter; topics: string[] }) {
  const router = useRouter();
  const go = (form: HTMLFormElement) => {
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form)) if (typeof value === "string" && value) params.set(key, value);
    const query = params.toString();
    router.push(query ? `/teacher/library?${query}` : "/teacher/library");
  };
  const select = (id: string, label: string, value: string | undefined, all: string, options: [string, string][], key: keyof Filter) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-small text-text-secondary">
        {label}
      </label>
      <select id={id} name={key} defaultValue={value ?? ""} className={field}>
        <option value="">{all}</option>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
  return (
    // Remounted for every filter the page arrives with, so the selects show it.
    <form
      key={JSON.stringify(filter)}
      onChange={(event) => go(event.currentTarget)}
      onSubmit={(event) => event.preventDefault()}
      className="flex flex-wrap gap-3"
    >
      {filter.type && <input type="hidden" name="type" value={filter.type} />}
      {select("filter-level", "Уровень", filter.level, "Все уровни", LEVELS.map((l) => [l, l]), "level")}
      {select("filter-topic", "Тема", filter.topic, "Все темы", topics.map((t) => [t, t]), "topic")}
      {select("filter-age", "Возраст", filter.age, "Любой возраст", AGE_GROUPS.map((a) => [a, AGE_GROUP_LABELS[a]]), "age")}
    </form>
  );
}
