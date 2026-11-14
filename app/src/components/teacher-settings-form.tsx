"use client";

import { type FormEvent, useState } from "react";
import { TIME_ZONES } from "@/domain/student";
import { Button } from "./button";
import { routerClient } from "./router-client";

/** The teacher's time zone (#80): her time of every lesson is shown in it. */
export function TeacherSettingsForm({ timeZone }: { timeZone: string }) {
  const [value, setValue] = useState(timeZone);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("saving");
    try {
      await routerClient.teacher.settings.save.mutate({ timeZone: value as (typeof TIME_ZONES)[number]["id"] });
      setState("saved");
    } catch {
      setState("failed");
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label htmlFor="teacher-timeZone" className="text-small text-text-secondary">
        Часовой пояс
      </label>
      <select
        id="teacher-timeZone"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setState("idle");
        }}
        className="h-10 rounded-control border border-border bg-bg px-3"
      >
        {TIME_ZONES.map((zone) => (
          <option key={zone.id} value={zone.id}>
            {zone.label}
          </option>
        ))}
      </select>
      <p className="text-small text-text-secondary">Ваше время у уроков считается по этому поясу; время учеников не меняется.</p>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={state === "saving"}>
          Сохранить
        </Button>
        <span role="status" className="text-small text-text-secondary">
          {state === "saved" && "Сохранено"}
          {state === "failed" && "Не получилось сохранить"}
        </span>
      </div>
    </form>
  );
}
