"use client";

import { useState } from "react";
import { type Recording, RECORDING_LABELS, RECORDINGS, reportRecordingUrl } from "@/domain/report";

type Urls = Record<Recording, string | null>;

/**
 * The recordings «было» and «стало» of a report (#269): the teacher uploads
 * a file for each, replaces or removes it; the parent's page plays them once
 * the report is published.
 */
export function ReportRecordings({ reportId, recordings }: { reportId: string; recordings: Urls }) {
  // A replaced recording keeps its address; the version makes the player load the new one.
  const [urls, setUrls] = useState<Urls>(recordings);
  const [busy, setBusy] = useState<Recording | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(which: Recording, file: File) {
    setBusy(which);
    setError(null);
    try {
      const response = await fetch(reportRecordingUrl(reportId, which), { method: "PUT", body: file });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Не получилось загрузить запись. Попробуйте ещё раз");
        return;
      }
      setUrls((current) => ({ ...current, [which]: `${reportRecordingUrl(reportId, which)}?v=${Date.now()}` }));
    } catch {
      setError("Не получилось загрузить запись. Проверьте интернет и попробуйте ещё раз");
    } finally {
      setBusy(null);
    }
  }

  async function remove(which: Recording) {
    setBusy(which);
    setError(null);
    try {
      const response = await fetch(reportRecordingUrl(reportId, which), { method: "DELETE" });
      if (response.ok) setUrls((current) => ({ ...current, [which]: null }));
      else setError("Не получилось убрать запись. Попробуйте ещё раз");
    } catch {
      setError("Не получилось убрать запись. Проверьте интернет и попробуйте ещё раз");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="font-semibold">Записи «было / стало»</p>
      {RECORDINGS.map((which) => {
        const label = RECORDING_LABELS[which];
        return (
          <div key={which} className="flex flex-wrap items-center gap-3">
            <label className="flex flex-col gap-1 text-small">
              <span className="text-text-secondary">Запись «{label.toLowerCase()}»</span>
              <input
                type="file"
                accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/ogg,.mp3,.m4a,.wav,.ogg"
                disabled={busy !== null}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void upload(which, file);
                }}
              />
            </label>
            {urls[which] && (
              <>
                <audio controls preload="none" src={urls[which]!} aria-label={label} />
                <button type="button" disabled={busy !== null} onClick={() => void remove(which)} className="text-small text-text-secondary hover:text-text">
                  Убрать запись «{label.toLowerCase()}»
                </button>
              </>
            )}
          </div>
        );
      })}
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
