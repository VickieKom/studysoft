"use client";

import { useId, useState } from "react";
import { MAX_BLOCKS, numberLines, periodLabel, type ReportBlock, type ReportNumbers, reportText } from "@/domain/report";
import { Button } from "./button";
import { routerClient } from "./router-client";

type Listed = { id: string; status: "draft" | "published"; periodFrom: string; periodTo: string };
type Draft = {
  id: string;
  firstName: string;
  periodFrom: string;
  periodTo: string;
  blocks: ReportBlock[];
  showPayments: boolean;
  numbers: ReportNumbers;
  balance: string | null;
};
/** A block on screen; one the teacher added here has its title editable. */
type Block = ReportBlock & { key: number; own: boolean };

const STATUS_LABELS = { draft: "Черновик", published: "Опубликован" } as const;
const field = "rounded-control border border-border bg-bg px-3 py-2";

/**
 * «Отчёты» on the card (#267): the student's reports, and a draft with the
 * period's numbers and the teacher's blocks. «Скопировать текст» gives the
 * report as text for a messenger with the parent's link; «Показать оплаты»
 * adds the balance line to that text only.
 */
export function StudentReports({ studentId, reports }: { studentId: string; reports: Listed[] }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [showPayments, setShowPayments] = useState(false);
  const [state, setState] = useState<"idle" | "saved" | "copied">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextKey, setNextKey] = useState(0);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const opened = await routerClient.teacher.reports.open.mutate({ studentId });
      setDraft(opened);
      setBlocks(opened.blocks.map((b, i) => ({ ...b, key: i, own: false })));
      setNextKey(opened.blocks.length);
      setShowPayments(opened.showPayments);
      setState("idle");
    } catch {
      setError("Не получилось открыть отчёт. Проверьте интернет и попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  }

  function change(next: Block[]) {
    setBlocks(next);
    setState("idle");
  }

  const kept = () => blocks.filter((b) => b.title.trim() !== "").map(({ title, text }) => ({ title: title.trim(), text }));
  /** A section of her own with text but no title would be dropped, its text with it. */
  const untitled = () => blocks.some((b) => b.title.trim() === "" && b.text.trim() !== "");

  async function save() {
    if (!draft) return;
    if (untitled()) {
      setError("Назовите раздел с текстом или уберите его");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await routerClient.teacher.reports.save.mutate({ reportId: draft.id, blocks: kept(), showPayments });
      setState("saved");
    } catch {
      setError("Не получилось сохранить. Проверьте интернет и попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!draft) return;
    setError(null);
    try {
      const { url } = await routerClient.teacher.links.parent.query({ studentId });
      const text = reportText({ ...draft, blocks: kept(), balance: showPayments ? draft.balance : null, link: url });
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setError("Не удалось скопировать");
    }
  }

  const lines = draft ? numberLines(draft.numbers) : [];
  return (
    <section aria-label="Отчёты" className="mt-6 flex flex-col gap-3 border-t border-border pt-4">
      <h2 className="text-small font-semibold text-text-secondary">Отчёты</h2>
      {reports.length === 0 ? (
        <p className="text-small text-text-secondary">Отчётов пока нет</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {reports.map((r) => (
            <li key={r.id} className="text-small">
              <span className="font-semibold">{STATUS_LABELS[r.status]}</span> · {periodLabel(r.periodFrom, r.periodTo)}
            </li>
          ))}
        </ul>
      )}
      {!draft && (
        <Button variant="secondary" className="self-start" disabled={busy} onClick={() => void open()}>
          Новый отчёт
        </Button>
      )}
      {draft && (
        <div role="group" aria-label="Черновик отчёта" className="flex flex-col gap-4 rounded-card border border-border p-4">
          <p className="font-semibold">Отчёт за {periodLabel(draft.periodFrom, draft.periodTo)}</p>
          {lines.length === 0 ? (
            <p className="text-small text-text-secondary">Нет данных за период: цифр в отчёте не будет</p>
          ) : (
            <ul aria-label="Цифры" className="flex flex-col gap-1 text-small">
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          {blocks.map((block, index) => (
            <BlockEditor
              key={block.key}
              block={block}
              onChange={(next) => change(blocks.map((b, i) => (i === index ? next : b)))}
              onRemove={() => change(blocks.filter((_, i) => i !== index))}
            />
          ))}
          <p className="text-small text-text-secondary">Пустые разделы в отчёт не попадают</p>
          <Button
            variant="secondary"
            className="self-start"
            disabled={blocks.length >= MAX_BLOCKS}
            onClick={() => {
              change([...blocks, { title: "", text: "", key: nextKey, own: true }]);
              setNextKey(nextKey + 1);
            }}
          >
            Добавить раздел
          </Button>
          {draft.balance && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={showPayments}
                  onChange={(e) => {
                    setShowPayments(e.target.checked);
                    setState("idle");
                  }}
                />
                Показать оплаты
              </label>
              <span className="text-small text-text-secondary">только в тексте для мессенджера: {draft.balance}</span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={busy} onClick={() => void save()}>
              Сохранить черновик
            </Button>
            <Button variant="secondary" onClick={() => void copy()}>
              Скопировать текст
            </Button>
            {state !== "idle" && (
              <p role="status" className="text-small text-green-700">
                {state === "saved" ? "Черновик сохранён" : "Текст скопирован"}
              </p>
            )}
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

function BlockEditor({ block, onChange, onRemove }: { block: Block; onChange: (next: Block) => void; onRemove: () => void }) {
  const id = useId();
  const title = block.title.trim() || "Новый раздел";
  return (
    <div className="flex flex-col gap-1">
      {block.own && (
        <label className="flex flex-col gap-1">
          <span className="text-small text-text-secondary">Название раздела</span>
          <input maxLength={100} value={block.title} onChange={(e) => onChange({ ...block, title: e.target.value })} className={`${field} h-10`} />
        </label>
      )}
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="font-semibold">
          {title}
        </label>
        <button type="button" aria-label={`Убрать раздел «${title}»`} onClick={onRemove} className="text-small text-text-secondary hover:text-text">
          Убрать
        </button>
      </div>
      <textarea id={id} rows={3} maxLength={5000} value={block.text} onChange={(e) => onChange({ ...block, text: e.target.value })} className={field} />
    </div>
  );
}
