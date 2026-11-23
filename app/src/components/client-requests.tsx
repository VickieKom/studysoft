"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import {
  DECLINE_REASON_LABELS,
  DECLINE_REASONS,
  type DeclineReason,
  MAX_DECLINE_COMMENT_LENGTH,
  MAX_REQUEST_CONTACT_LENGTH,
  MAX_REQUEST_NAME_LENGTH,
  MAX_REQUEST_SCHOOL_YEAR_LENGTH,
  REQUEST_SOURCE_LABELS,
  REQUEST_SOURCES,
  REQUEST_STAGE_LABELS,
  REQUEST_STAGES,
  type RequestSource,
  type RequestStage,
} from "@/domain/requests";
import { Button } from "./button";
import { routerClient } from "./router-client";

export type ClientRequestView = {
  id: string;
  firstName: string;
  age: number | null;
  schoolYear: string | null;
  contact: string | null;
  source: RequestSource;
  requestedOn: string;
  stage: RequestStage;
  declineReason: DeclineReason | null;
  declineComment: string | null;
};

const field = "h-10 rounded-control border border-border bg-bg px-3";

/** A procedure's own message for a refusal the teacher can act on, else a general one. */
function message(cause: unknown): string {
  const code = (cause as { data?: { code?: string } } | null)?.data?.code;
  return code === "BAD_REQUEST" && cause instanceof Error ? cause.message : "Не получилось сохранить. Попробуйте ещё раз";
}

/** «12 ноября» for a date of the form. */
const dayMonth = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });

/**
 * «Привлечение клиентов» (#337): «Новая заявка» and the requests by stage. A
 * request moves to any stage with «Этап»; «Отказ» asks for a reason and an
 * optional comment. «Удалить заявку» asks first, then erases the request's
 * personal data.
 */
export function ClientRequests({ requests, today }: { requests: ClientRequestView[]; today: string }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const declineDialog = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);

  async function run(change: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await change();
      router.refresh();
      return true;
    } catch (cause) {
      setError(message(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function onStage(id: string, stage: RequestStage) {
    if (stage === "declined") {
      setDeclining(id);
      declineDialog.current?.showModal();
      return;
    }
    void run(() => routerClient.teacher.requests.move.mutate({ id, stage }));
  }

  return (
    <div className="flex flex-col gap-6">
      {adding ? (
        <NewRequestForm today={today} onDone={() => setAdding(false)} />
      ) : (
        <div>
          <Button onClick={() => setAdding(true)}>Новая заявка</Button>
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {REQUEST_STAGES.map((stage) => {
          const here = requests.filter((r) => r.stage === stage);
          return (
            <section key={stage} aria-label={REQUEST_STAGE_LABELS[stage]} className="flex flex-col gap-2 rounded-card border border-border p-4">
              <h2 className="font-semibold">
                {REQUEST_STAGE_LABELS[stage]} <span className="text-text-secondary">{here.length}</span>
              </h2>
              {here.length === 0 ? (
                <p className="text-small text-text-secondary">Пусто</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {here.map((request) => (
                    <li key={request.id} className="flex flex-col gap-2 rounded-control border border-border p-3 text-small">
                      <div className="flex flex-wrap gap-x-3">
                        <span className="font-semibold">{request.firstName}</span>
                        {request.age !== null && <span>{request.age} лет</span>}
                        {request.schoolYear && <span>{request.schoolYear} класс</span>}
                        <span className="text-text-secondary">{REQUEST_SOURCE_LABELS[request.source]}</span>
                        <span className="text-text-secondary">{dayMonth(request.requestedOn)}</span>
                      </div>
                      {request.contact && <span>{request.contact}</span>}
                      {request.declineReason && (
                        <span>
                          Причина: {DECLINE_REASON_LABELS[request.declineReason]}
                          {request.declineComment ? ` — ${request.declineComment}` : ""}
                        </span>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          aria-label="Этап"
                          value={request.stage}
                          disabled={busy}
                          onChange={(event) => onStage(request.id, event.target.value as RequestStage)}
                          className={field}
                        >
                          {REQUEST_STAGES.map((s) => (
                            <option key={s} value={s}>
                              {REQUEST_STAGE_LABELS[s]}
                            </option>
                          ))}
                        </select>
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() => {
                            setDeleting(request.id);
                            deleteDialog.current?.showModal();
                          }}
                        >
                          Удалить заявку
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <dialog
        ref={declineDialog}
        aria-labelledby="request-decline-title"
        onClose={() => setDeclining(null)}
        className="rounded-card border border-border p-6 backdrop:bg-black/30"
      >
        {declining && (
          <DeclineForm
            onSave={async (reason, comment) => {
              if (await run(() => routerClient.teacher.requests.move.mutate({ id: declining, stage: "declined", reason, comment }))) declineDialog.current?.close();
            }}
            onCancel={() => declineDialog.current?.close()}
            busy={busy}
          />
        )}
      </dialog>

      <dialog
        ref={deleteDialog}
        aria-labelledby="request-delete-title"
        onClose={() => setDeleting(null)}
        className="rounded-card border border-border p-6 backdrop:bg-black/30"
      >
        <h2 id="request-delete-title" className="text-h3 font-semibold">
          Удалить заявку?
        </h2>
        <p className="mt-2 text-small text-text-secondary">Имя и контакт сотрутся. В метриках заявка останется без них.</p>
        <div className="mt-4 flex gap-3">
          <Button
            disabled={busy}
            onClick={async () => {
              if (deleting && (await run(() => routerClient.teacher.requests.remove.mutate({ id: deleting })))) deleteDialog.current?.close();
            }}
          >
            Удалить
          </Button>
          <Button variant="secondary" onClick={() => deleteDialog.current?.close()}>
            Отмена
          </Button>
        </div>
      </dialog>
    </div>
  );
}

function DeclineForm({ onSave, onCancel, busy }: { onSave: (reason: DeclineReason, comment: string) => void; onCancel: () => void; busy: boolean }) {
  const [reason, setReason] = useState<DeclineReason>("expensive");
  const [comment, setComment] = useState("");
  return (
    <div className="flex flex-col gap-3">
      <h2 id="request-decline-title" className="text-h3 font-semibold">
        Отказ
      </h2>
      <label className="flex flex-col gap-1 text-small">
        Причина
        <select value={reason} onChange={(event) => setReason(event.target.value as DeclineReason)} className={field}>
          {DECLINE_REASONS.map((r) => (
            <option key={r} value={r}>
              {DECLINE_REASON_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-small">
        Комментарий
        <textarea
          value={comment}
          maxLength={MAX_DECLINE_COMMENT_LENGTH}
          onChange={(event) => setComment(event.target.value)}
          rows={3}
          className="rounded-control border border-border bg-bg px-3 py-2"
        />
      </label>
      <div className="flex gap-3">
        <Button disabled={busy} onClick={() => onSave(reason, comment)}>
          Сохранить
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </div>
  );
}

function NewRequestForm({ today, onDone }: { today: string; onDone: () => void }) {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [age, setAge] = useState("");
  const [schoolYear, setSchoolYear] = useState("");
  const [contact, setContact] = useState("");
  const [source, setSource] = useState<RequestSource | "">("");
  const [requestedOn, setRequestedOn] = useState(today);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (!firstName.trim()) return setError("Укажите имя ребёнка");
    if (!source) return setError("Выберите, откуда заявка");
    const years = age.trim() === "" ? null : Number(age);
    if (years !== null && (!Number.isInteger(years) || years < 1 || years > 99)) return setError("Возраст — число лет");
    setPending(true);
    setError(null);
    try {
      await routerClient.teacher.requests.create.mutate({ firstName, age: years, schoolYear, contact, source, requestedOn });
      onDone();
      router.refresh();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setPending(false);
    }
  }

  const label = "flex flex-col gap-1 text-small";
  return (
    <form noValidate onSubmit={onSubmit} aria-label="Новая заявка" className="flex flex-col gap-3 rounded-card border border-border p-4">
      <div className="grid gap-3 md:grid-cols-3">
        <label className={label}>
          Имя ребёнка
          <input value={firstName} maxLength={MAX_REQUEST_NAME_LENGTH} onChange={(event) => setFirstName(event.target.value)} className={field} />
        </label>
        <label className={label}>
          Возраст
          <input inputMode="numeric" value={age} onChange={(event) => setAge(event.target.value)} className={field} />
        </label>
        <label className={label}>
          Класс
          <input value={schoolYear} maxLength={MAX_REQUEST_SCHOOL_YEAR_LENGTH} onChange={(event) => setSchoolYear(event.target.value)} className={field} />
        </label>
        <label className={label}>
          Контакт родителя
          <input value={contact} maxLength={MAX_REQUEST_CONTACT_LENGTH} onChange={(event) => setContact(event.target.value)} className={field} />
        </label>
        <label className={label}>
          Источник
          <select value={source} onChange={(event) => setSource(event.target.value as RequestSource | "")} className={field}>
            <option value="">—</option>
            {REQUEST_SOURCES.map((s) => (
              <option key={s} value={s}>
                {REQUEST_SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Дата
          <input type="date" value={requestedOn} onChange={(event) => setRequestedOn(event.target.value)} className={field} />
        </label>
      </div>
      {error && (
        <p role="alert" className="rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          Сохранить
        </Button>
        <Button variant="secondary" onClick={onDone}>
          Отмена
        </Button>
      </div>
    </form>
  );
}
