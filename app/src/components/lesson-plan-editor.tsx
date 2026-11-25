"use client";

import { PREP_GROUP_LABELS, prepMaterialGroups } from "@/domain/prep-materials";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { HOMEWORK_STAGE_MINUTES, MAX_STAGE_VIDEO_TASKS, VIDEO_STAGE_MINUTES, type LessonPlan, type PlanStage } from "@/domain/lesson-plan";
import type { MaterialKind } from "@/domain/library";
import { Button } from "./button";
import { type PrepBankLesson, PrepBankTasks } from "./prep-bank-tasks";
import { routerClient } from "./router-client";

type Choice = { id: string; label: string; title: string };
type Material = { id: string; kind: MaterialKind; title: string; forStudent: boolean; textbookLessonId: string | null };

const field = "rounded-control border border-border bg-bg px-3 py-2";
const KIND_ONE: Record<MaterialKind, string> = { warmup: "Разминка", game: "Игра", video: "Видео" };

/** A textbook lesson's video the plan may take (#329), with its lesson's bank tasks by prompt. */
export type TextbookVideoChoice = {
  fileId: string;
  name: string;
  lessonId: string;
  lessonTitle: string;
  /** The lesson's bank tasks fit for a video, by their position in the bank. */
  tasks: { index: number; prompt: string }[];
  /** The bank's revision the positions belong to. */
  revision: string;
};

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
  textbookVideos,
  openedVideos,
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
  /** The textbook's lesson videos (#329), each with its lesson's bank tasks fit for a video. */
  textbookVideos: TextbookVideoChoice[];
  /** The videos opened to the student from this preparation, still open. */
  openedVideos: string[];
}) {
  const router = useRouter();
  // A video stage whose lesson's bank changed since it was saved (#329): its positions name other tasks now, so its ticks are cleared to pick anew.
  const choiceOf = (fileId: string, lessonId: string) => textbookVideos.find((v) => v.fileId === fileId && v.lessonId === lessonId);
  const [stages, setStages] = useState<PlanStage[]>(() =>
    start.stages.map((s) => {
      const video = s.type === "textbook_video" ? choiceOf(s.fileId, s.lessonId) : undefined;
      return s.type === "textbook_video" && video && video.revision !== s.revision ? { ...s, tasks: [], revision: video.revision } : s;
    }),
  );
  const changedBanks = start.stages.some((s) => {
    const video = s.type === "textbook_video" ? choiceOf(s.fileId, s.lessonId) : undefined;
    return s.type === "textbook_video" && video !== undefined && video.revision !== s.revision;
  });
  // «Открыть ученику» opens the saved plan: not while the screen shows changes it does not have.
  const [unsaved, setUnsaved] = useState(changedBanks);
  const [adding, setAdding] = useState<string>(materials[0]?.id ?? "");
  const [homework, setHomework] = useState<string>(homeworkId ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const videoKey = (v: { fileId: string; lessonId: string }) => `${v.lessonId}:${v.fileId}`;
  const [addingVideo, setAddingVideo] = useState<string>(textbookVideos[0] ? videoKey(textbookVideos[0]) : "");
  const [opened, setOpened] = useState<Set<string>>(new Set(openedVideos));

  async function openVideo(fileId: string) {
    setError(null);
    try {
      await routerClient.teacher.prep.openTextbookVideo.mutate({ lessonId, fileId });
      setOpened((before) => new Set([...before, fileId]));
    } catch (caught) {
      const message = (caught as { message?: string })?.message;
      const code = (caught as { data?: { code?: string } })?.data?.code;
      setError((code === "NOT_FOUND" || code === "CONFLICT") && message ? message : "Не получилось открыть видео. Попробуйте ещё раз");
    }
  }

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

  // Counts the edits, so a save marks the plan saved only when nothing changed while it was in flight (#381).
  const edits = useRef(0);
  const change = (next: PlanStage[]) => {
    edits.current += 1;
    setStages(next);
    setState("idle");
    setUnsaved(true);
  };
  const update = (i: number, patch: Partial<PlanStage>) => change(stages.map((s, j) => (j === i ? ({ ...s, ...patch } as PlanStage) : s)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...stages];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    change(next);
  };

  async function save() {
    const editsSaved = edits.current;
    setState("saving");
    setError(null);
    try {
      await routerClient.teacher.prep.save.mutate({ lessonId, plan: { stages }, homeworkId: homework || null, revision });
      const unchanged = edits.current === editsSaved;
      setState(unchanged ? "saved" : "idle");
      setUnsaved(!unchanged);
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
    if (stage.type === "textbook_video") return `Видео: ${choiceOf(stage.fileId, stage.lessonId)?.name ?? "не найдено"}`;
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
                {stage.type === "textbook_video" && (
                  <div className="flex basis-full flex-col gap-2">
                    {changedBanks && stage.tasks.length === 0 && (
                      <p className="text-small text-danger">Задания урока учебника изменились — отметьте задания к видео заново</p>
                    )}
                    {(choiceOf(stage.fileId, stage.lessonId)?.tasks.length ?? 0) === 0 ? (
                      <p className="text-small text-text-secondary">В банке урока нет подтверждённых заданий, подходящих к видео</p>
                    ) : (
                      <ul aria-label="Задания к видео" className="flex flex-col gap-1">
                        {choiceOf(stage.fileId, stage.lessonId)!.tasks.map(({ index: t, prompt }) => (
                          <li key={t} className="flex items-start gap-2 text-small">
                            <label className="flex items-start gap-2">
                              <input
                                type="checkbox"
                                aria-label="К видео"
                                checked={stage.tasks.includes(t)}
                                disabled={!stage.tasks.includes(t) && stage.tasks.length >= MAX_STAGE_VIDEO_TASKS}
                                onChange={(e) =>
                                  update(i, { tasks: e.target.checked ? [...stage.tasks, t].sort((a, b) => a - b) : stage.tasks.filter((x) => x !== t) })
                                }
                              />
                              <span>{prompt}</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="secondary" disabled={unsaved} onClick={() => void openVideo(stage.fileId)}>
                        Открыть ученику
                      </Button>
                      {unsaved && <span className="text-small text-text-secondary">Сохраните план, чтобы открыть видео</span>}
                      {!unsaved && opened.has(stage.fileId) && <span className="text-small text-accent-900">Открыто ученику</span>}
                      <span className="text-caption text-text-muted">Ученик увидит видео сразу и до часа после конца урока</span>
                    </div>
                  </div>
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
        {textbookVideos.length > 0 && (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-small text-text-secondary">Видео урока</span>
              <select value={addingVideo} onChange={(e) => setAddingVideo(e.target.value)} className={`${field} h-10`}>
                {textbookVideos.map((v) => (
                  <option key={videoKey(v)} value={videoKey(v)}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="secondary"
              onClick={() => {
                const video = textbookVideos.find((v) => videoKey(v) === addingVideo);
                if (video)
                  change([
                    ...stages,
                    { type: "textbook_video", fileId: video.fileId, lessonId: video.lessonId, tasks: [], revision: video.revision, minutes: VIDEO_STAGE_MINUTES },
                  ]);
              }}
            >
              Добавить видео
            </Button>
          </>
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
