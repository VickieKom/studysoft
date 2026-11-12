"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import {
  DEFAULT_TIME_ZONE,
  isBlank,
  LEVELS,
  type Level,
  CONTACT_FIELDS,
  type ContactKey,
  PROFILE_FIELDS,
  type ProfileKey,
  type Status,
  STATUS_LABELS,
  STATUSES,
  TIME_ZONES,
  type TimeZoneId,
} from "@/domain/student";
import { Button } from "./button";
import { routerClient } from "./router-client";

export type StudentFormValues = {
  firstName: string;
  lastName: string;
  level: Level;
  timeZone: TimeZoneId;
  status: Status;
} & Record<ProfileKey, string> &
  Record<ContactKey, string>;
type Values = StudentFormValues;

type Props =
  | { mode: "create" }
  | { mode: "edit"; studentId: string; initial: Values };

const fieldClass = "h-10 rounded-control border border-border bg-bg px-3 outline-none focus:border-green-500";
const areaClass = "min-h-20 rounded-control border border-border bg-bg px-3 py-2 outline-none focus:border-green-500";

function emptyProfile(): Record<ProfileKey, string> {
  return Object.fromEntries(PROFILE_FIELDS.map((field) => [field.key, ""])) as Record<ProfileKey, string>;
}

function profileOf(values: Values): Record<ProfileKey, string> {
  return Object.fromEntries(PROFILE_FIELDS.map((field) => [field.key, values[field.key]])) as Record<ProfileKey, string>;
}

function contactsOf(values: Values): Record<ContactKey, string> {
  return Object.fromEntries(CONTACT_FIELDS.map((field) => [field.key, values[field.key]])) as Record<ContactKey, string>;
}

const emptyContacts = () =>
  Object.fromEntries(CONTACT_FIELDS.map((field) => [field.key, ""])) as Record<ContactKey, string>;

/** One form for creating and editing a student (#18). Editing adds the status. */
export function StudentForm(props: Props) {
  const router = useRouter();
  const initial: Values =
    props.mode === "edit"
      ? props.initial
      : {
          firstName: "",
          lastName: "",
          level: "A1",
          timeZone: DEFAULT_TIME_ZONE,
          status: "discussion",
          ...emptyProfile(),
          ...emptyContacts(),
        };
  const [values, setValues] = useState(initial);
  const [firstNameMissing, setFirstNameMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const cardUrl = (id: string) => `/teacher/students/${id}`;
  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((v) => ({ ...v, [key]: value }));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBlank(values.firstName)) {
      setFirstNameMissing(true);
      return;
    }
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const fields = {
        firstName: values.firstName,
        lastName: values.lastName,
        level: values.level,
        timeZone: values.timeZone,
      };
      const { id } =
        props.mode === "create"
          ? await routerClient.teacher.students.create.mutate(fields)
          : await routerClient.teacher.students.update.mutate({
              ...fields,
              ...profileOf(values),
              ...contactsOf(values),
              id: props.studentId,
              status: values.status,
            });
      router.push(cardUrl(id));
      router.refresh();
    } catch {
      setError("Не удалось сохранить. Попробуйте ещё раз");
      setPending(false);
    }
  }

  function onCancel() {
    router.push(props.mode === "edit" ? cardUrl(props.studentId) : "/teacher/students");
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-md flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="student-firstName" className="text-small text-text-secondary">
          Имя
        </label>
        <input
          id="student-firstName"
          name="firstName"
          required
          value={values.firstName}
          aria-invalid={firstNameMissing || undefined}
          aria-describedby={firstNameMissing ? "first-name-missing" : undefined}
          onChange={(event) => {
            set("firstName", event.target.value);
            setFirstNameMissing(false);
          }}
          className={fieldClass}
        />
        {firstNameMissing && (
          <span id="first-name-missing" className="text-small text-danger">
            Укажите имя
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="student-lastName" className="text-small text-text-secondary">
          Фамилия
        </label>
        <input
          id="student-lastName"
          name="lastName"
          value={values.lastName}
          onChange={(event) => set("lastName", event.target.value)}
          className={fieldClass}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="student-level" className="text-small text-text-secondary">
          Уровень
        </label>
        <select
          id="student-level"
          name="level"
          value={values.level}
          onChange={(event) => set("level", event.target.value as Level)}
          className={fieldClass}
        >
          {LEVELS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="student-timeZone" className="text-small text-text-secondary">
          Часовой пояс
        </label>
        <select
          id="student-timeZone"
          name="timeZone"
          value={values.timeZone}
          onChange={(event) => set("timeZone", event.target.value as TimeZoneId)}
          className={fieldClass}
        >
          {TIME_ZONES.map((zone) => (
            <option key={zone.id} value={zone.id}>
              {zone.label}
            </option>
          ))}
        </select>
      </div>
      {props.mode === "edit" && (
        <div className="flex flex-col gap-1">
          <label htmlFor="student-status" className="text-small text-text-secondary">
            Статус
          </label>
          <select
            id="student-status"
            name="status"
            value={values.status}
            onChange={(event) => set("status", event.target.value as Status)}
            className={fieldClass}
          >
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
      )}
      {props.mode === "edit" &&
        PROFILE_FIELDS.map((field) => (
          <div key={field.key} className="flex flex-col gap-1">
            <label htmlFor={`student-${field.key}`} className="text-small text-text-secondary">
              {field.label}
            </label>
            {field.multiline ? (
              <textarea
                id={`student-${field.key}`}
                name={field.key}
                value={values[field.key]}
                onChange={(event) => set(field.key, event.target.value)}
                className={areaClass}
              />
            ) : (
              <input
                id={`student-${field.key}`}
                name={field.key}
                value={values[field.key]}
                onChange={(event) => set(field.key, event.target.value)}
                className={fieldClass}
              />
            )}
          </div>
        ))}
      {props.mode === "edit" && (
        <fieldset className="flex flex-col gap-4 border-t border-border pt-4">
          <legend className="mb-2 text-small font-semibold text-text-secondary">Контакты — видны только вам</legend>
          {CONTACT_FIELDS.map((field) => (
            <div key={field.key} className="flex flex-col gap-1">
              <label htmlFor={`student-${field.key}`} className="text-small text-text-secondary">
                {field.label}
              </label>
              <input
                id={`student-${field.key}`}
                name={field.key}
                value={values[field.key]}
                onChange={(event) => set(field.key, event.target.value)}
                className={fieldClass}
              />
            </div>
          ))}
        </fieldset>
      )}
      {error && (
        <p role="alert" className="rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          Сохранить
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </form>
  );
}
