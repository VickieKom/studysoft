"use client";

import { useState } from "react";
import { routerClient } from "./router-client";

const LABELS = { student: "Перевыпустить ссылку ученика", parent: "Перевыпустить ссылку родителя" } as const;

/**
 * "Перевыпустить": a new link for one role, at once and without a
 * confirmation (product owner's decision in #21). The old link and every
 * session opened from it stop working.
 */
export function ReissueLinkButton({ studentId, role }: { studentId: string; role: keyof typeof LABELS }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");

  async function reissue() {
    try {
      await routerClient.teacher.links.reissue.mutate({ studentId, role });
      setState("done");
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={reissue}
        className="inline-flex h-10 items-center rounded-control px-4 text-button font-semibold text-text-secondary hover:bg-surface"
      >
        {LABELS[role]}
      </button>
      <span role="status" className="text-small text-text-secondary">
        {state === "done" && "Старая ссылка больше не действует"}
        {state === "failed" && "Не удалось перевыпустить"}
      </span>
    </div>
  );
}
