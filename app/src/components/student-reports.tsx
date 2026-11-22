"use client";

import { useId, useState } from "react";
import { MAX_BLOCKS, numberLines, periodLabel, type ReportBlock, type ReportNumbers, reportText } from "@/domain/report";
import { Button } from "./button";
import { ReportRecordings } from "./report-recordings";
import { routerClient } from "./router-client";

type Listed = { id: string; status: "draft" | "published"; periodFrom: string; periodTo: string };
type Draft = {
  id: string;
  status: "draft" | "published";
  firstName: string;
  periodFrom: string;
  periodTo: string;
  blocks: ReportBlock[];
  showPayments: boolean;
  numbers: ReportNumbers;
  balance: string | null;
  recordings: { before: string | null; after: string | null };
};
/** A block on screen; one the teacher added here has its title editable. */
type Block = ReportBlock & { key: number; own: boolean };

const STATUS_LABELS = { draft: "Черновик", published: "Опубликован" } as const;
const field = "rounded-control border border-border bg-bg px-3 py-2";

/**
 * «Отчёты» on the card (#267): the student's reports, and a draft with the
 * period's numbers and the teacher's blocks. «Скопировать текст» gives the
 * report as text for a messenger with the parent's link; «Показать оплаты»
 * adds the balance line to that text only. «Опубликовать» puts it on the
 * parent's page; a published report opens with «Открыть», is edited there
 * and taken down with «Снять с публикации» (#268). «Открыть» on another
 * report while this one has unsaved edits asks first (#280).
 */
export function StudentReports({ studentId, reports }: { studentId: string; reports: Listed[] }) {
  const [list, setList] = useState(reports);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [showPayments, setShowPayments] = useState(false);
  const [state, setState] = useState<"idle" | "saved" | "copied">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextKey, setNextKey] = useState(0);
  // Edits not saved yet (#280): «Открыть» on another report asks before dropping them.
  const [dirty, setDirty] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);

  /** Runs a request with the buttons off; a failure shows `failed`, or the server's own message for a refusal. */
  async function run(failed: string, action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      const refused = (cause as { data?: { code?: string } }).data?.code === "CONFLICT";
      setError(refused ? (cause as Error).message : failed);
    } finally {
      setBusy(false);
    }
  }

  function show(opened: Draft) {
    setDraft(opened);
    setBlocks(opened.blocks.map((b, i) => ({ ...b, key: i, own: false })));
    setNextKey(opened.blocks.length);
    setShowPayments(opened.showPayments);
    setState("idle");
    setDirty(false);
    setAsking(null);
  }

  async function refresh() {
    setList(await routerClient.teacher.reports.list.query({ studentId }));
  }

  const openFailed = "Не получилось открыть отчёт. Проверьте интернет и попробуйте ещё раз";
  const open = () => run(openFailed, async () => show(await routerClient.teacher.reports.open.mutate({ studentId })));
  const openReport = (reportId: string) => run(openFailed, async () => show(await routerClient.teacher.reports.get.query({ reportId })));

  function change(next: Block[]) {
    setBlocks(next);
    setState("idle");
    setDirty(true);
  }

  /** «Открыть»: at once with nothing unsaved; otherwise the teacher is asked first. */
  const openOther = (reportId: string) => (dirty ? setAsking(reportId) : void openReport(reportId));

  const kept = () => blocks.filter((b) => b.title.trim() !== "").map(({ title, text }) => ({ title: title.trim(), text }));
  /** A section of her own with text but no title would be dropped, its text with it. */
  const untitled = () => blocks.some((b) => b.title.trim() === "" && b.text.trim() !== "");
  const untitledError = "Назовите раздел с текстом или уберите его";

  const saveFailed = "Не получилось сохранить. Проверьте интернет и попробуйте ещё раз";
  const save = () =>
    run(saveFailed, async () => {
      if (!draft) return;
      if (untitled()) {
        setError(untitledError);
        return;
      }
      await routerClient.teacher.reports.save.mutate({ reportId: draft.id, blocks: kept(), showPayments });
      setState("saved");
      setDirty(false);
    });

  /** «Опубликовать»: saves what is on screen, then publishes. */
  const publish = () =>
    run(saveFailed, async () => {
      if (!draft) return;
      if (untitled()) {
        setError(untitledError);
        return;
      }
      await routerClient.teacher.reports.save.mutate({ reportId: draft.id, blocks: kept(), showPayments });
      await routerClient.teacher.reports.publish.mutate({ reportId: draft.id });
      setDraft(null);
      setDirty(false);
      await refresh();
    });

  const unpublish = () =>
    run(saveFailed, async () => {
      if (!draft) return;
      await routerClient.teacher.reports.unpublish.mutate({ reportId: draft.id });
      setDraft(null);
      setDirty(false);
      await refresh();
    });

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
      {list.length === 0 ? (
        <p className="text-small text-text-secondary">Отчётов пока нет</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {list.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 text-small">
              <span>
                <span className="font-semibold">{STATUS_LABELS[r.status]}</span> · {periodLabel(r.periodFrom, r.periodTo)}
              </span>
              {draft?.id !== r.id && (
                <button type="button" disabled={busy} onClick={() => openOther(r.id)} className="text-green-600 hover:text-green-700">
                  Открыть
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {asking && (
        <div role="alertdialog" aria-label="Изменения не сохранены" className="flex flex-col gap-2 rounded-card border border-border bg-surface p-3">
          <p className="font-semibold">Изменения не сохранены</p>
          <p className="text-small text-text-secondary">Если открыть другой отчёт, правки в этом пропадут</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setAsking(null)}>
              Остаться
            </Button>
            <Button variant="secondary" onClick={() => void openReport(asking)}>
              Открыть без сохранения
            </Button>
          </div>
        </div>
      )}
      {!draft && (
        <Button variant="secondary" className="self-start" disabled={busy} onClick={() => void open()}>
          Новый отчёт
        </Button>
      )}
      {draft && (
        <div role="group" aria-label={draft.status === "published" ? "Опубликованный отчёт" : "Черновик отчёта"} className="flex flex-col gap-4 rounded-card border border-border p-4">
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
          <ReportRecordings key={draft.id} reportId={draft.id} recordings={draft.recordings} />
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
                    setDirty(true);
                  }}
                />
                Показать оплаты
              </label>
              <span className="text-small text-text-secondary">только в тексте для мессенджера: {draft.balance}</span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={busy} onClick={() => void save()}>
              {draft.status === "published" ? "Сохранить" : "Сохранить черновик"}
            </Button>
            {draft.status === "draft" ? (
              <Button disabled={busy} onClick={() => void publish()}>
                Опубликовать
              </Button>
            ) : (
              <Button variant="secondary" disabled={busy} onClick={() => void unpublish()}>
                Снять с публикации
              </Button>
            )}
            <Button variant="secondary" onClick={() => void copy()}>
              Скопировать текст
            </Button>
            {state !== "idle" && (
              <p role="status" className="text-small text-green-700">
                {state === "copied" ? "Текст скопирован" : draft.status === "published" ? "Отчёт сохранён" : "Черновик сохранён"}
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
