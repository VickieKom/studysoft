"use client";

import { PREP_GROUP_LABELS, prepMaterialGroups } from "@/domain/prep-materials";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { HOMEWORK_STAGE_MINUTES, type LessonPlan, type PlanStage } from "@/domain/lesson-plan";
import type { MaterialKind } from "@/domain/library";
import { Button } from "./button";
import { type PrepBankLesson, PrepBankTasks } from "./prep-bank-tasks";
import { routerClient } from "./router-client";

type Choice = { id: string; label: string; title: string };
type Material = { id: string; kind: MaterialKind; title: string; forStudent: boolean; textbookLessonId: string | null };

const field = "rounded-control border border-border bg-bg px-3 py-2";
const KIND_ONE: Record<MaterialKind, string> = { warmup: "Разминка", game: "Игра", video: "Видео" };

/**
 * A lesson's plan by stages (#151): in order, with minutes; the book lesson
 * with the exercises to skip, and materials from «Библиотека». «Сохранить
 * план», or «Утвердить план» for the assistant's draft, makes the lesson
 * «подготовлен», with the homework draft chosen for it. A submitted homework
 * waiting for review comes first as «Домашка» (#153); removed, it can be
 * added back. The book lesson's confirmed bank tasks build the homework
 * draft (#226).
 */
export function LessonPlanEditor({
  lessonId,
  start,
  fromAssistant,
  revision,
  lessons,
  materials,
  homeworkDrafts,
  homeworkId,
  waitingHomework,
  stageHomework,
  bank,
}: {
  lessonId: string;
  start: LessonPlan;
  fromAssistant: boolean;
  revision: string;
  lessons: Choice[];
  materials: Material[];
  homeworkDrafts: { id: string; title: string }[];
  homeworkId: string | null;
  waitingHomework: { id: string; title: string } | null;
  stageHomework: { id: string; title: string }[];
  bank: PrepBankLesson[];
}) {
  const router = useRouter();
  const [stages, setStages] = useState<PlanStage[]>(start.stages);
  const [adding, setAdding] = useState<string>(materials[0]?.id ?? "");
  const [homework, setHomework] = useState<string>(homeworkId ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  // The student's games first, then the plan's book lessons', then the rest (#293).
  const groups = prepMaterialGroups(
    materials,
    stages.flatMap((s) => (s.type === "book" ? [s.lessonId] : [])),
  );
  const options = (list: Material[]) =>
    list.map((m) => (
      <option key={m.id} value={m.id}>
        {m.title}
      </option>
    ));

  const change = (next: PlanStage[]) => {
    setStages(next);
    setState("idle");
  };
  const update = (i: number, patch: Partial<PlanStage>) => change(stages.map((s, j) => (j === i ? ({ ...s, ...patch } as PlanStage) : s)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...stages];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    change(next);
  };

  async function save() {
    setState("saving");
    setError(null);
    try {
      await routerClient.teacher.prep.save.mutate({ lessonId, plan: { stages }, homeworkId: homework || null, revision });
      setState("saved");
      router.refresh();
    } catch (caught) {
      const code = (caught as { data?: { code?: string } })?.data?.code;
      const message = (caught as { message?: string })?.message;
      setError((code === "BAD_REQUEST" || code === "CONFLICT") && message ? message : "Не получилось сохранить. Попробуйте ещё раз");
      setState("idle");
    }
  }

  const titleOf = (stage: PlanStage) => {
    if (stage.type === "book") return `Student's Book: ${lessons.find((l) => l.id === stage.lessonId)?.title ?? "урок не найден"}`;
    if (stage.type === "homework") {
      const title = stageHomework.find((h) => h.id === stage.homeworkId)?.title ?? waitingHomework?.title;
      return title ? `Домашка: ${title}` : "Домашка";
    }
    const material = materials.find((m) => m.id === stage.materialId);
    return material ? `${KIND_ONE[material.kind]}: ${material.title}` : "Материал не найден";
  };

  return (
    <div className="flex flex-col gap-5">
      {fromAssistant && <p className="rounded-control bg-accent-50 px-3 py-2 text-small text-accent-900">План от ассистента</p>}
      {stages.length === 0 ? (
        <p className="text-text-secondary">В плане пока нет этапов</p>
      ) : (
        <ol aria-label="План урока" className="flex flex-col gap-3">
          {stages.map((stage, i) => (
            <li key={i} className="flex flex-col gap-2 rounded-card border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">
                  {i + 1}. {titleOf(stage)}
                </span>
                <span className="flex flex-wrap gap-2">
                  <Button variant="secondary" disabled={i === 0} onClick={() => move(i, -1)}>
                    Выше
                  </Button>
                  <Button variant="secondary" disabled={i === stages.length - 1} onClick={() => move(i, 1)}>
                    Ниже
                  </Button>
                  <Button variant="secondary" onClick={() => change(stages.filter((_, j) => j !== i))}>
                    Убрать
                  </Button>
                </span>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                {stage.type === "book" && (
                  <>
                    <label className="flex flex-col gap-1">
                      <span className="text-small text-text-secondary">Урок учебника</span>
                      <select value={stage.lessonId} onChange={(e) => update(i, { lessonId: e.target.value })} className={`${field} h-10`}>
                        {lessons.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-small text-text-secondary">Пропустить упражнения</span>
                      <input value={stage.skip} onChange={(e) => update(i, { skip: e.target.value })} placeholder="3, 5" className={field} />
                    </label>
                  </>
                )}
                <label className="flex flex-col gap-1">
                  <span className="text-small text-text-secondary">Минуты</span>
                  <input
                    type="number"
                    min={0}
                    max={180}
                    value={stage.minutes}
                    onChange={(e) => update(i, { minutes: Math.max(0, Math.min(180, Number(e.target.value) || 0)) })}
                    className={`${field} w-24`}
                  />
                </label>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-end gap-3">
        {waitingHomework && !stages.some((s) => s.type === "homework" && s.homeworkId === waitingHomework.id) && (
          <Button
            variant="secondary"
            onClick={() => change([{ type: "homework", homeworkId: waitingHomework.id, minutes: HOMEWORK_STAGE_MINUTES }, ...stages])}
          >
            Добавить разбор домашки
          </Button>
        )}
        {lessons.length > 0 && (
          <Button
            variant="secondary"
            onClick={() => change([...stages, { type: "book", lessonId: lessons[0]!.id, skip: "", minutes: 20 }])}
          >
            Добавить урок учебника
          </Button>
        )}
        {materials.length > 0 && (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-small text-text-secondary">Добавить из библиотеки</span>
              <select value={adding} onChange={(e) => setAdding(e.target.value)} className={`${field} h-10`}>
                {groups.forStudent.length + groups.forLessons.length === 0
                  ? options(materials)
                  : (["forStudent", "forLessons", "rest"] as const).map(
                      (key) =>
                        groups[key].length > 0 && (
                          <optgroup key={key} label={PREP_GROUP_LABELS[key]}>
                            {options(groups[key])}
                          </optgroup>
                        ),
                    )}
              </select>
            </label>
            <Button variant="secondary" onClick={() => adding && change([...stages, { type: "material", materialId: adding, minutes: 5 }])}>
              Добавить этап
            </Button>
          </>
        )}
      </div>

      <section aria-label="Домашка к уроку" className="flex flex-col gap-2 rounded-card border border-border p-4">
        <h2 className="text-h3 font-semibold">Домашка к уроку</h2>
        {homeworkDrafts.length === 0 ? (
          <p className="text-small text-text-secondary">У ученика нет черновиков домашки: импортируйте или попросите ассистента на карточке ученика</p>
        ) : (
          <label className="flex flex-col gap-1">
            <span className="text-small text-text-secondary">Черновик домашки</span>
            <select value={homework} onChange={(e) => { setHomework(e.target.value); setState("idle"); }} className={`${field} h-10`}>
              <option value="">Без домашки</option>
              {homeworkDrafts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {bank.map((lesson) => (
          <PrepBankTasks
            key={lesson.bookLessonId}
            lessonId={lessonId}
            lesson={lesson}
            homeworkId={homework || null}
            onBuilt={(id) => {
              setHomework(id);
              setState("idle");
              router.refresh();
            }}
          />
        ))}
        <p className="text-caption text-text-muted">Ученик увидит домашку после «Завершить урок»</p>
      </section>

      {error && (
        <p role="alert" className="whitespace-pre-line rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={state === "saving"} onClick={save}>
          {fromAssistant ? "Утвердить план" : "Сохранить план"}
        </Button>
        <span role="status" className="text-small text-text-secondary">
          {state === "saved" && "План сохранён"}
        </span>
      </div>
    </div>
  );
}
