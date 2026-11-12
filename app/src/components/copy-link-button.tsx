"use client";

import { useState } from "react";
import { routerClient } from "./router-client";

const LABELS = { student: "Ссылка ученика", parent: "Ссылка родителя" } as const;

/** Copies the student's or the parent's permanent link; copying never changes it (#19, #20). */
export function CopyLinkButton({ studentId, role }: { studentId: string; role: keyof typeof LABELS }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      const { url } = await routerClient.teacher.links[role].query({ studentId });
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={copy}
        className="inline-flex h-10 items-center rounded-control border border-border px-4 text-button font-semibold hover:bg-surface"
      >
        {LABELS[role]}
      </button>
      <span role="status" className="text-small text-text-secondary">
        {state === "copied" && "Ссылка скопирована"}
        {state === "failed" && "Не удалось скопировать"}
      </span>
    </div>
  );
}
