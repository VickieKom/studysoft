"use client";

import { type FormEvent, type ReactNode, useId, useState } from "react";
import { gapCount, IMAGE_TYPES, MAX_IMAGE_BYTES, SKILLS, type Task, type TaskType } from "@/domain/homework-format";
import { Button } from "./button";

const SKILL_LABELS: Record<(typeof SKILLS)[number], string> = {
  grammar: "Грамматика",
  vocabulary: "Лексика",
  reading: "Чтение",
  writing: "Письмо",
  speaking: "Говорение",
  listening: "Аудирование",
};

const field = "rounded-control border border-border bg-bg px-3 py-2";
const lines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

type Props = {
  /** Where the task's stored picture is served, to show it while editing. */
  imageUrl: string | null;
  type: TaskType;
  task: Task | null;
  pending: boolean;
  error: string | null;
  onSave: (task: Task) => void;
  onCancel: () => void;
};

/**
 * One task of a draft in plain fields (#37): one option, variant or pair per
 * line. What is missing is said here before saving; the server checks the
 * whole homework against the format again.
 */
export function HomeworkTaskForm({ imageUrl, type, task, pending, error, onSave, onCancel }: Props) {
  const id = useId();
  const [prompt, setPrompt] = useState(task?.prompt ?? "");
  const [topic, setTopic] = useState(task?.topic ?? "");
  const [skill, setSkill] = useState<string>(task?.skill ?? "");
  const [optionsText, setOptionsText] = useState(task && "options" in task && task.options ? task.options.join("\n") : "");
  const [correct, setCorrect] = useState<number[]>(
    task?.type === "single_choice" ? [task.answer] : task?.type === "multiple_choice" ? task.answers : [],
  );
  const [gapText, setGapText] = useState(task?.type === "gap" ? task.text : "");
  const [gapAnswers, setGapAnswers] = useState<string[]>(
    task?.type === "gap" ? task.answers.map((variants) => variants.join("\n")) : [],
  );
  const [pairsText, setPairsText] = useState(
    task?.type === "match" ? task.pairs.map((p) => `${p.left} = ${p.right}`).join("\n") : "",
  );
  const [wordsText, setWordsText] = useState(task?.type === "order" ? task.words.join(" ") : "");
  const [alternativesText, setAlternativesText] = useState(
    task?.type === "order" ? (task.alternatives ?? []).map((words) => words.join(" ")).join("\n") : "",
  );
  const [hint, setHint] = useState(task && "hint" in task ? (task.hint ?? "") : "");
  const [accept, setAccept] = useState<("image" | "audio")[]>(
    task?.type === "file" ? (task.accept ?? ["image", "audio"]) : ["image", "audio"],
  );
  // The stored reference, a new data URL, or nothing.
  const [image, setImage] = useState<string | undefined>(task?.image);
  const [problem, setProblem] = useState<string | null>(null);

  function pickImage(file: File | undefined) {
    if (!file) return;
    if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) return setProblem("Картинка — PNG, JPEG или WebP");
    if (file.size > MAX_IMAGE_BYTES) return setProblem("Картинка больше 2 МБ");
    const reader = new FileReader();
    reader.onload = () => {
      setProblem(null);
      setImage(String(reader.result));
    };
    reader.readAsDataURL(file);
  }

  const options = lines(optionsText);
  const gaps = gapCount(gapText);

  function build(): Task | string {
    if (!prompt.trim()) return "Напишите текст задания";
    const common = {
      prompt: prompt.trim(),
      ...(topic.trim() ? { topic: topic.trim() } : {}),
      ...(skill ? { skill: skill as (typeof SKILLS)[number] } : {}),
      ...(task?.source ? { source: task.source } : {}),
      ...(image ? { image } : {}),
    };
    const withHint = hint.trim() ? { hint: hint.trim() } : {};
    switch (type) {
      case "single_choice":
      case "multiple_choice": {
        if (options.length < 2) return "Нужно хотя бы два варианта, по одному на строку";
        const chosen = correct.filter((i) => i < options.length);
        if (chosen.length === 0) return "Отметьте правильный ответ";
        return type === "single_choice"
          ? { ...common, type, options, answer: chosen[0]! }
          : { ...common, type, options, answers: chosen };
      }
      case "gap": {
        if (gaps === 0) return "В тексте нужен хотя бы один пропуск ___";
        const answers = Array.from({ length: gaps }, (_, i) => lines(gapAnswers[i] ?? ""));
        const empty = answers.findIndex((variants) => variants.length === 0);
        if (empty >= 0) return `Укажите правильный ответ для пропуска ${empty + 1}`;
        const choices = lines(optionsText);
        return { ...common, type, text: gapText, answers, ...(choices.length > 0 ? { options: choices } : {}) };
      }
      case "match": {
        const pairs = lines(pairsText).map((line) => {
          const [left = "", ...rest] = line.split("=");
          return { left: left.trim(), right: rest.join("=").trim() };
        });
        if (pairs.length < 2 || pairs.some((p) => !p.left || !p.right))
          return "Нужно хотя бы две пары, по одной на строку: слева = справа";
        return { ...common, type, pairs };
      }
      case "order": {
        const words = wordsText.split(/\s+/).filter(Boolean);
        if (words.length < 2) return "Нужно хотя бы два слова в правильном порядке";
        const alternatives = lines(alternativesText).map((line) => line.split(/\s+/));
        return { ...common, type, words, ...(alternatives.length > 0 ? { alternatives } : {}) };
      }
      case "written":
      case "voice":
        return { ...common, type, ...withHint };
      case "file":
        if (accept.length === 0) return "Отметьте, что можно прикрепить: фото или аудио";
        return { ...common, type, accept, ...withHint };
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const built = build();
    if (typeof built === "string") return setProblem(built);
    setProblem(null);
    onSave(built);
  }

  const shown = problem ?? error;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <Labelled id={`${id}-prompt`} label="Текст задания">
        <input id={`${id}-prompt`} value={prompt} onChange={(e) => setPrompt(e.target.value)} className={field} />
      </Labelled>

      <div className="flex flex-col gap-2">
        {image && (
          // biome-ignore lint/performance/noImgElement: the image optimiser fetches without the user's session, so a permission-checked file cannot go through it
          // eslint-disable-next-line @next/next/no-img-element -- same reason as above
          <img
            src={image.startsWith("data:") ? image : (imageUrl ?? undefined)}
            alt="Картинка к заданию"
            className="max-h-48 self-start rounded-control border border-border"
          />
        )}
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor={`${id}-image`} className="text-small text-text-secondary">
            {image ? "Заменить картинку" : "Картинка"}
            <span className="text-text-muted"> — необязательно, PNG, JPEG или WebP до 2 МБ</span>
          </label>
          <input
            id={`${id}-image`}
            type="file"
            accept={IMAGE_TYPES.join(",")}
            onChange={(e) => pickImage(e.target.files?.[0])}
            className="text-small"
          />
          {image && (
            <Button variant="secondary" onClick={() => setImage(undefined)} disabled={pending}>
              Убрать картинку
            </Button>
          )}
        </div>
      </div>

      {(type === "single_choice" || type === "multiple_choice") && (
        <>
          <Labelled id={`${id}-options`} label="Варианты" note="по одному на строку">
            <textarea
              id={`${id}-options`}
              rows={4}
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
              className={field}
            />
          </Labelled>
          {options.length > 0 && (
            <fieldset className="flex flex-col gap-1">
              <legend className="text-small text-text-secondary">
                {type === "single_choice" ? "Правильный ответ" : "Правильные ответы"}
              </legend>
              {options.map((option, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    id={`${id}-correct-${i}`}
                    type={type === "single_choice" ? "radio" : "checkbox"}
                    name={`${id}-correct`}
                    checked={correct.includes(i)}
                    onChange={() =>
                      setCorrect(
                        type === "single_choice"
                          ? [i]
                          : correct.includes(i)
                            ? correct.filter((c) => c !== i)
                            : [...correct, i].sort((a, b) => a - b),
                      )
                    }
                  />
                  <label htmlFor={`${id}-correct-${i}`}>{option}</label>
                </div>
              ))}
            </fieldset>
          )}
        </>
      )}

      {type === "gap" && (
        <>
          <Labelled id={`${id}-text`} label="Текст с пропусками" note="пропуск — три подчёркивания ___">
            <textarea
              id={`${id}-text`}
              rows={2}
              value={gapText}
              onChange={(e) => setGapText(e.target.value)}
              className={field}
            />
          </Labelled>
          {Array.from({ length: gaps }, (_, i) => (
            <Labelled key={i} id={`${id}-gap-${i}`} label={`Ответы для пропуска ${i + 1}`} note="по одному варианту на строку">
              <textarea
                id={`${id}-gap-${i}`}
                rows={2}
                value={gapAnswers[i] ?? ""}
                onChange={(e) => setGapAnswers(Array.from({ length: gaps }, (_, j) => (j === i ? e.target.value : (gapAnswers[j] ?? ""))))}
                className={field}
              />
            </Labelled>
          ))}
          <Labelled id={`${id}-choices`} label="Слова на выбор" note="необязательно, по одному на строку; без них ученик пишет сам">
            <textarea
              id={`${id}-choices`}
              rows={2}
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
              className={field}
            />
          </Labelled>
        </>
      )}

      {type === "match" && (
        <Labelled id={`${id}-pairs`} label="Пары" note="по одной на строку: слева = справа">
          <textarea id={`${id}-pairs`} rows={4} value={pairsText} onChange={(e) => setPairsText(e.target.value)} className={field} />
        </Labelled>
      )}

      {type === "order" && (
        <>
          <Labelled id={`${id}-words`} label="Слова в правильном порядке" note="через пробел">
            <input id={`${id}-words`} value={wordsText} onChange={(e) => setWordsText(e.target.value)} className={field} />
          </Labelled>
          <Labelled id={`${id}-alternatives`} label="Другие правильные порядки" note="необязательно, по одному на строку">
            <textarea
              id={`${id}-alternatives`}
              rows={2}
              value={alternativesText}
              onChange={(e) => setAlternativesText(e.target.value)}
              className={field}
            />
          </Labelled>
        </>
      )}

      {type === "file" && (
        <fieldset className="flex gap-4">
          <legend className="text-small text-text-secondary">Что можно прикрепить</legend>
          {(["image", "audio"] as const).map((kind) => (
            <div key={kind} className="flex items-center gap-2">
              <input
                id={`${id}-accept-${kind}`}
                type="checkbox"
                checked={accept.includes(kind)}
                onChange={() => setAccept(accept.includes(kind) ? accept.filter((k) => k !== kind) : [...accept, kind])}
              />
              <label htmlFor={`${id}-accept-${kind}`}>{kind === "image" ? "Фото" : "Аудио"}</label>
            </div>
          ))}
        </fieldset>
      )}

      {(type === "written" || type === "voice" || type === "file") && (
        <Labelled id={`${id}-hint`} label="Подсказка" note="необязательно">
          <input id={`${id}-hint`} value={hint} onChange={(e) => setHint(e.target.value)} className={field} />
        </Labelled>
      )}

      <div className="flex flex-wrap gap-3">
        <Labelled id={`${id}-topic`} label="Тема" note="необязательно">
          <input id={`${id}-topic`} value={topic} onChange={(e) => setTopic(e.target.value)} className={field} />
        </Labelled>
        <Labelled id={`${id}-skill`} label="Навык" note="необязательно">
          <select id={`${id}-skill`} value={skill} onChange={(e) => setSkill(e.target.value)} className={`${field} h-10`}>
            <option value="">—</option>
            {SKILLS.map((s) => (
              <option key={s} value={s}>
                {SKILL_LABELS[s]}
              </option>
            ))}
          </select>
        </Labelled>
      </div>

      {shown && (
        <p role="alert" className="whitespace-pre-line rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          {shown}
        </p>
      )}
      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          Сохранить задание
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={pending}>
          Отмена
        </Button>
      </div>
    </form>
  );
}

function Labelled({ id, label, note, children }: { id: string; label: string; note?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-small text-text-secondary">
        {label}
        {note && <span className="text-text-muted"> — {note}</span>}
      </label>
      {children}
    </div>
  );
}
