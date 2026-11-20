"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  addWord,
  type BookStage,
  bookStageLabel,
  goToStage,
  type HomeworkStage,
  homeworkStageLabel,
  type KeptState,
  type LessonBook,
  type BookLesson,
  type LessonMessage,
  lessonChannel,
  lessonMessageSchema,
  lessonPage,
  type LessonState,
  lessonStorageKey,
  type LessonWord,
  MAX_TRANSLATION_LENGTH,
  MAX_WORD_LENGTH,
  keptStateSchema,
  newer,
  pageIn,
  removeStage,
  type StageHomework,
  stageKey,
  STATE_SAVE_MS,
  toggleShown,
  turnPage,
  visibleTasks,
} from "@/domain/lesson-state";
import { BOOK_LABELS } from "@/domain/textbook";
import { Button } from "./button";
import { routerClient } from "./router-client";

type Material =
  | { id: string; kind: "warmup"; title: string; picture: string | null; questions: string[] }
  | { id: string; kind: "game" | "video"; title: string };

export type LessonResourcesView = {
  books: LessonBook[];
  lessons: BookLesson[];
  tracks: { name: string; url: string }[];
  materials: Material[];
  homework: StageHomework[];
};

const HINT = "В Телемосте покажите окно «Экран для ученика» и включите звук";
const KIND_ONE: Record<Material["kind"], string> = { warmup: "Разминка", game: "Игра", video: "Видео" };
/** The stage says it is there every two seconds; after this long without a word it reads as closed. */
const STAGE_SILENT_MS = 5000;
/** The note is saved a moment after she stops typing. */
const NOTE_PAUSE_MS = 700;

/** The stage window of a lesson: one per lesson, so «Открыть сцену» brings back the same one. */
export function openStageWindow(lessonId: string) {
  window.open(`/stage/${lessonId}`, `studysoft-stage-${lessonId}`, "popup,width=1280,height=800");
}

function readLocal(lessonId: string): KeptState | null {
  try {
    const parsed = keptStateSchema.safeParse(JSON.parse(window.localStorage.getItem(lessonStorageKey(lessonId)) ?? "null"));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function clock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The control panel of the lesson mode (#152), the teacher's only: the
 * stages with minutes, the current stage's controls, the timer and the note.
 * Rendered in the browser alone (lesson-mode-client.tsx), since it starts
 * from the state this browser kept.
 * Every change goes to the stage at once over BroadcastChannel, is kept in
 * this browser, and reaches the server every few seconds.
 */
export function LessonPanel({
  lessonId,
  firstName,
  durationMinutes,
  textbookTitle,
  resources,
  serverKept,
  serverNote,
}: {
  lessonId: string;
  firstName: string;
  durationMinutes: number;
  textbookTitle: string | null;
  resources: LessonResourcesView;
  serverKept: KeptState;
  serverNote: string;
}) {
  // This browser may hold a newer state than the server: a reload within the few seconds between saves.
  const [kept, setKept] = useState<KeptState>(() => newer(serverKept, readLocal(lessonId))!);
  const [lastHello, setLastHello] = useState(0);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [gameResult, setGameResult] = useState<boolean | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [saveError, setSaveError] = useState(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const keptRef = useRef(kept);
  const savedRevision = useRef(serverKept.revision);
  const saving = useRef(false);

  const send = useCallback((message: LessonMessage) => channel.current?.postMessage(message), []);

  useEffect(() => {
    const ch = new BroadcastChannel(lessonChannel(lessonId));
    channel.current = ch;
    ch.onmessage = (event: MessageEvent) => {
      const message = lessonMessageSchema.safeParse(event.data);
      if (!message.success) return;
      if (message.data.type === "hello") {
        setLastHello(Date.now());
        ch.postMessage({ type: "state", kept: keptRef.current } satisfies LessonMessage);
      } else if (message.data.type === "sound") setSoundBlocked(message.data.status === "blocked");
      else if (message.data.type === "game-result") setGameResult(message.data.kept);
      else if (message.data.type === "board") {
        // The teacher writes on the board in the stage window (#155); the panel keeps it with the rest of the state.
        const board = message.data.board;
        setKept((k) => ({ revision: k.revision + 1, state: { ...k.state, board } }));
      }
    };
    return () => {
      ch.close();
      channel.current = null;
    };
  }, [lessonId]);

  // Kept in this browser and sent to the stage on every change.
  useEffect(() => {
    keptRef.current = kept;
    window.localStorage.setItem(lessonStorageKey(lessonId), JSON.stringify(kept));
    send({ type: "state", kept });
  }, [kept, lessonId, send]);

  // To the server every few seconds, when something changed.
  useEffect(() => {
    const timer = setInterval(() => {
      const current = keptRef.current;
      if (saving.current || current.revision <= savedRevision.current) return;
      saving.current = true;
      routerClient.teacher.lessonMode.saveState
        .mutate({ lessonId, revision: current.revision, state: current.state })
        .then(
          () => {
            savedRevision.current = Math.max(savedRevision.current, current.revision);
            setSaveError(false);
          },
          () => setSaveError(true),
        )
        .finally(() => {
          saving.current = false;
        });
    }, STATE_SAVE_MS);
    return () => clearInterval(timer);
  }, [lessonId]);

  // The lesson's clock.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const change = (update: (state: LessonState) => LessonState) =>
    setKept((k) => {
      const state = update(k.state);
      return state === k.state ? k : { revision: k.revision + 1, state };
    });

  const { state } = kept;
  const current = state.stages[state.current];
  const lessonOf = (id: string) => resources.lessons.find((l) => l.id === id);
  const materialOf = (id: string) => resources.materials.find((m) => m.id === id);
  const homeworkOf = (id: string) => resources.homework.find((h) => h.id === id);
  const label = (stage: LessonState["stages"][number]) =>
    stage.type === "book"
      ? bookStageLabel(lessonOf(stage.lessonId))
      : stage.type === "homework"
        ? homeworkStageLabel(homeworkOf(stage.homeworkId))
        : (materialOf(stage.materialId)?.title ?? "материал удалён");
  const stageOn = lastHello > 0 && now - lastHello < STAGE_SILENT_MS;
  const [adding, setAdding] = useState(resources.materials[0]?.id ?? "");
  const [finishing, setFinishing] = useState(false);

  return (
    <main className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-h1 font-bold">
            {firstName}
            {textbookTitle && ` · ${textbookTitle}`}
          </h1>
          <p className="text-text-secondary">
            <span aria-label="Время урока">
              {clock(now - Date.parse(state.startedAt))} / {durationMinutes} мин
            </span>
            {current && ` · этап: ${current.minutes} мин`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => openStageWindow(lessonId)}>
              Открыть сцену
            </Button>
            <Button onClick={() => setFinishing(true)}>Завершить урок</Button>
          </span>
          <span className={`text-small ${stageOn ? "text-green-700" : "text-text-secondary"}`}>{stageOn ? "сцена на связи" : "сцена не открыта"}</span>
        </div>
      </header>
      <p className="rounded-card border border-border bg-surface p-3 text-small">{HINT}</p>
      {saveError && <p className="text-small text-danger">Не получилось сохранить урок на сервере. Он сохранён в этом браузере; попробуем ещё раз</p>}

      <section className="flex flex-col gap-2">
        <h2 className="text-h3 font-semibold">Этапы урока</h2>
        <ul aria-label="Этапы урока" className="flex flex-col gap-2">
          {state.stages.map((stage, i) => (
            <li
              key={`${i}-${stageKey(stage)}`}
              className={`flex items-center gap-3 rounded-control border px-3 py-2 ${i === state.current ? "border-green-600 bg-green-50" : "border-border"}`}
            >
              <span aria-hidden="true" className="w-4 text-green-700">
                {stage.done ? "✓" : ""}
              </span>
              <button
                type="button"
                aria-current={i === state.current ? "step" : undefined}
                onClick={() => change((s) => goToStage(s, i))}
                className="flex-1 text-left font-semibold hover:underline"
              >
                {label(stage)}
              </button>
              <span className="text-small text-text-secondary">{stage.minutes} мин</span>
              <button
                type="button"
                onClick={() => change((s) => removeStage(s, i))}
                className="text-small text-text-secondary hover:text-danger"
                aria-label={`Убрать этап ${label(stage)}`}
              >
                Убрать
              </button>
            </li>
          ))}
        </ul>
        {resources.materials.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Добавить из библиотеки"
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              className="rounded-control border border-border bg-bg px-3 py-2"
            >
              {resources.materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {KIND_ONE[m.kind]}: {m.title}
                </option>
              ))}
            </select>
            <Button
              variant="secondary"
              disabled={!adding}
              onClick={() => change((s) => ({ ...s, stages: [...s.stages, { type: "material", materialId: adding, minutes: 0, done: false }] }))}
            >
              Добавить этап
            </Button>
          </div>
        )}
      </section>

      {current?.type === "book" && (
        <BookControls
          stage={current}
          lesson={lessonOf(current.lessonId)}
          books={resources.books}
          layout={state.layout}
          onStage={(next) => change((s) => ({ ...s, stages: s.stages.map((x, i) => (i === s.current ? next : x)) }))}
          onLayout={(layout) => change((s) => ({ ...s, layout }))}
        />
      )}
      {current?.type === "book" && (
        <Tracks
          names={lessonOf(current.lessonId)?.tracks ?? []}
          available={resources.tracks}
          track={state.track}
          soundBlocked={soundBlocked}
          onPlay={(name) => change((s) => ({ ...s, track: { name, playing: true, run: (s.track?.run ?? 0) + 1 } }))}
          onStop={() => change((s) => (s.track ? { ...s, track: { ...s.track, playing: false } } : s))}
        />
      )}
      {current?.type === "material" && <MaterialNote material={materialOf(current.materialId)} gameResult={gameResult} />}
      {current?.type === "homework" && (
        <HomeworkControls
          stage={current}
          homework={homeworkOf(current.homeworkId)}
          onStage={(next) => change((s) => ({ ...s, stages: s.stages.map((x, i) => (i === s.current ? next : x)) }))}
        />
      )}

      <LessonWords words={state.words} onChange={(words) => change((s) => ({ ...s, words }))} />

      <Note lessonId={lessonId} initial={serverNote} />

      {finishing && (
        <FinishLesson
          lessonId={lessonId}
          words={state.words}
          onCancel={() => setFinishing(false)}
          onFinished={() => {
            send({ type: "finished" });
            try {
              window.localStorage.removeItem(lessonStorageKey(lessonId));
            } catch {
              // Nothing kept to remove.
            }
          }}
        />
      )}
    </main>
  );
}

function BookControls({
  stage,
  lesson,
  books,
  layout,
  onStage,
  onLayout,
}: {
  stage: BookStage;
  lesson: BookLesson | undefined;
  books: LessonBook[];
  layout: LessonState["layout"];
  onStage: (next: BookStage) => void;
  onLayout: (layout: LessonState["layout"]) => void;
}) {
  const ready = books.filter((b) => b.pageCount > 0);
  const book = ready.find((b) => b.kind === stage.kind);
  const at = pageIn(stage, lesson, stage.kind);
  const go = (page: number) => onStage({ ...stage, pages: { ...stage.pages, [stage.kind]: page } });
  const pressed = (on: boolean) => `rounded-control border px-3 py-1.5 text-small ${on ? "border-green-600 bg-green-50 font-semibold" : "border-border"}`;
  return (
    <section aria-label="Учебник на сцене" className="flex flex-col gap-3 rounded-card border border-border p-4">
      <h2 className="text-h3 font-semibold">Учебник на сцене</h2>
      {book ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" aria-label="Предыдущая страница" onClick={() => go(turnPage(at, -1, layout, book.pageCount))} className={pressed(false)}>
              ‹
            </button>
            <span className="font-semibold">
              {BOOK_LABELS[stage.kind]} · стр. {at}
            </span>
            <button type="button" aria-label="Следующая страница" onClick={() => go(turnPage(at, 1, layout, book.pageCount))} className={pressed(false)}>
              ›
            </button>
            <button type="button" onClick={() => go(lessonPage(lesson, stage.kind))} className="text-small text-green-600 hover:text-green-700">
              К страницам урока
            </button>
          </div>
          {lesson?.pages[stage.kind] && (
            <p className="text-small text-text-secondary">
              Урок: стр. {lesson.pages[stage.kind]!.from}
              {lesson.pages[stage.kind]!.to !== lesson.pages[stage.kind]!.from && `–${lesson.pages[stage.kind]!.to}`}
            </p>
          )}
        </>
      ) : (
        <p className="text-small text-text-secondary">Страницы этой книги ещё не готовы</p>
      )}
      <div className="flex flex-wrap gap-2">
        {ready.map((b) => (
          <button
            key={b.kind}
            type="button"
            aria-pressed={b.kind === stage.kind}
            onClick={() => onStage({ ...stage, kind: b.kind })}
            className={pressed(b.kind === stage.kind)}
          >
            {BOOK_LABELS[b.kind]}
          </button>
        ))}
        <span className="mx-2 border-l border-border" />
        <button type="button" aria-pressed={layout === "single"} onClick={() => onLayout("single")} className={pressed(layout === "single")}>
          1 страница
        </button>
        <button type="button" aria-pressed={layout === "spread"} onClick={() => onLayout("spread")} className={pressed(layout === "spread")}>
          Разворот
        </button>
      </div>
    </section>
  );
}

function Tracks({
  names,
  available,
  track,
  soundBlocked,
  onPlay,
  onStop,
}: {
  names: string[];
  available: { name: string; url: string }[];
  track: LessonState["track"];
  soundBlocked: boolean;
  onPlay: (name: string) => void;
  onStop: () => void;
}) {
  const tracks = names.filter((n) => available.some((t) => t.name === n));
  if (tracks.length === 0) return null;
  return (
    <section aria-label="Треки урока" className="flex flex-col gap-2 rounded-card border border-border p-4">
      <h2 className="text-h3 font-semibold">Треки урока</h2>
      <div className="flex flex-wrap items-center gap-2">
        {tracks.map((name) => (
          <Button key={name} variant="secondary" aria-label={`Играть ${name}`} onClick={() => onPlay(name)}>
            ▶ {name}
          </Button>
        ))}
        {track?.playing && (
          <Button variant="secondary" onClick={onStop}>
            Стоп
          </Button>
        )}
      </div>
      {track?.playing && <p className="text-small text-text-secondary">На сцене играет {track.name}</p>}
      {soundBlocked && <p className="text-small text-danger">Звук на сцене выключен: нажмите «Включить звук» в окне сцены</p>}
    </section>
  );
}

/**
 * The homework under review on the stage (#153): «Все задания» or «Только
 * ошибки», and «Показать ответ» for a task — the stage shows a key only then.
 */
function HomeworkControls({
  stage,
  homework,
  onStage,
}: {
  stage: HomeworkStage;
  homework: StageHomework | undefined;
  onStage: (next: HomeworkStage) => void;
}) {
  const pressed = (on: boolean) => `rounded-control border px-3 py-1.5 text-small ${on ? "border-green-600 bg-green-50 font-semibold" : "border-border"}`;
  if (!homework) {
    return <p className="rounded-card border border-border p-4 text-small text-text-secondary">У этой домашки больше нет сданной попытки: её открыли заново</p>;
  }
  const tasks = visibleTasks(stage, homework);
  return (
    <section aria-label="Домашка на сцене" className="flex flex-col gap-3 rounded-card border border-border p-4">
      <h2 className="text-h3 font-semibold">Домашка на сцене</h2>
      <p className="text-small text-text-secondary">
        {homework.title} · {homework.correct} верно, {homework.wrong} неверно
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={stage.filter === "all"} onClick={() => onStage({ ...stage, filter: "all" })} className={pressed(stage.filter === "all")}>
          Все задания
        </button>
        <button
          type="button"
          aria-pressed={stage.filter === "wrong"}
          onClick={() => onStage({ ...stage, filter: "wrong" })}
          className={pressed(stage.filter === "wrong")}
        >
          Только ошибки
        </button>
      </div>
      {tasks.length === 0 ? (
        <p className="text-small text-text-secondary">Ошибок нет</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {tasks.map((task) => {
            const hasKey = task.key !== null || (task.sentences?.length ?? 0) > 0;
            const shown = stage.shown.includes(task.index);
            return (
              <li key={task.index} className="flex items-center gap-3 rounded-control border border-border px-3 py-2">
                <span className="flex-1 text-small">
                  {task.index + 1}. {task.prompt}
                  <span className="ml-2 text-text-secondary">
                    {task.verdict === null ? "ждёт проверки" : task.verdict ? "верно" : "неверно"}
                  </span>
                </span>
                {hasKey && (
                  <button type="button" aria-pressed={shown} onClick={() => onStage(toggleShown(stage, task.index))} className={pressed(shown)}>
                    {shown ? "Скрыть ответ" : "Показать ответ"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** «Слова урока» (#154): the words written on the board, for the student's vocabulary at «Завершить урок». */
function LessonWords({ words, onChange }: { words: LessonWord[]; onChange: (words: LessonWord[]) => void }) {
  const [word, setWord] = useState("");
  const [translation, setTranslation] = useState("");
  const field = "rounded-control border border-border bg-bg px-3 py-2";
  return (
    <section aria-label="Слова урока" className="flex flex-col gap-3 rounded-card border border-border p-4">
      <h2 className="text-h3 font-semibold">Слова урока</h2>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!word.trim()) return;
          onChange(addWord(words, { word, translation }));
          setWord("");
          setTranslation("");
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-small text-text-secondary">Слово</span>
          <input value={word} maxLength={MAX_WORD_LENGTH} onChange={(e) => setWord(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-small text-text-secondary">Перевод</span>
          <input value={translation} maxLength={MAX_TRANSLATION_LENGTH} onChange={(e) => setTranslation(e.target.value)} className={field} />
        </label>
        <Button type="submit" variant="secondary" disabled={!word.trim()}>
          Добавить слово
        </Button>
      </form>
      {words.length > 0 && (
        <ul className="flex flex-col gap-1">
          {words.map((w) => (
            <li key={w.word} className="flex items-center gap-3 text-small">
              <span className="flex-1">
                <span className="font-semibold">{w.word}</span>
                {w.translation && ` — ${w.translation}`}
              </span>
              <button
                type="button"
                onClick={() => onChange(words.filter((x) => x.word !== w.word))}
                className="text-text-secondary hover:text-danger"
                aria-label={`Убрать слово ${w.word}`}
              >
                Убрать
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-caption text-text-muted">Слова попадут в словарь ученика при «Завершить урок»</p>
    </section>
  );
}

type FinishFormData = Awaited<ReturnType<typeof routerClient.teacher.lessonMode.finishForm.query>>;

/**
 * «Завершить урок» (#154): one form — held and charged as in #82, the note,
 * the book lesson covered, the lesson's homework with its deadline, and the
 * words. All of it applies at once or not at all; then the card.
 */
function FinishLesson({
  lessonId,
  words,
  onCancel,
  onFinished,
}: {
  lessonId: string;
  words: LessonWord[];
  onCancel: () => void;
  onFinished: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FinishFormData | null>(null);
  const [bookLessonId, setBookLessonId] = useState("");
  const [charged, setCharged] = useState(true);
  const [note, setNote] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = "rounded-control border border-border bg-bg px-3 py-2";

  useEffect(() => {
    let live = true;
    routerClient.teacher.lessonMode.finishForm.query({ lessonId }).then(
      (data) => {
        if (!live) return;
        setForm(data);
        setBookLessonId(data.bookLessonId ?? "");
        setCharged(data.charged);
        setNote(data.note);
        setDueDate(data.homework?.dueDate ?? "");
      },
      () => live && setError("Не получилось открыть форму. Попробуйте ещё раз"),
    );
    return () => {
      live = false;
    };
  }, [lessonId]);

  async function finish() {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      const { studentId } = await routerClient.teacher.lessonMode.finish.mutate({
        lessonId,
        charged,
        note,
        bookLessonId: bookLessonId || null,
        homework: form.homework ? { id: form.homework.id, revision: form.homework.revision, dueDate } : null,
        words,
      });
      onFinished();
      router.push(`/teacher/students/${studentId}`);
    } catch (caught) {
      const code = (caught as { data?: { code?: string } })?.data?.code;
      const message = (caught as { message?: string })?.message;
      setError((code === "BAD_REQUEST" || code === "CONFLICT") && message ? message : "Не получилось завершить урок. Ничего не изменилось, попробуйте ещё раз");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex items-start justify-center overflow-auto bg-black/30 p-6">
      <div role="dialog" aria-modal="true" aria-labelledby="finish-heading" className="flex w-full max-w-xl flex-col gap-4 rounded-card bg-bg p-6 shadow">
        <h2 id="finish-heading" className="text-h2 font-semibold">
          Завершить урок
        </h2>
        {!form ? (
          <p className="text-small text-text-secondary">{error ?? "Загружаем…"}</p>
        ) : (
          <>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={charged} disabled={form.intro} onChange={(e) => setCharged(e.target.checked)} />
              <span>Списать{form.intro && " (вводный урок не списывается)"}</span>
            </label>
            {form.lessons.length > 0 && (
              <label className="flex flex-col gap-1">
                <span className="text-small text-text-secondary">Пройденный урок учебника</span>
                <select value={bookLessonId} onChange={(e) => setBookLessonId(e.target.value)} className={`${field} h-10`}>
                  <option value="">Учебник не проходили</option>
                  {form.lessons.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1">
              <span className="text-small text-text-secondary">Заметка</span>
              <textarea value={note} maxLength={5000} rows={4} onChange={(e) => setNote(e.target.value)} className={field} />
            </label>
            {form.homework ? (
              <div className="flex flex-col gap-2 rounded-control border border-border p-3">
                <p className="text-small">
                  Опубликовать домашку: <span className="font-semibold">{form.homework.title}</span>
                </p>
                <label className="flex flex-col gap-1">
                  <span className="text-small text-text-secondary">Срок</span>
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={`${field} w-48`} />
                </label>
              </div>
            ) : (
              <p className="text-small text-text-secondary">Домашки к уроку нет: её можно прикрепить в «Подготовке»</p>
            )}
            <div className="flex flex-col gap-1">
              <p className="text-small text-text-secondary">Слова в словарь ученика{bookLessonId && " (и слова урока учебника)"}</p>
              {words.length === 0 ? (
                <p className="text-small">Слов урока нет</p>
              ) : (
                <ul className="flex flex-wrap gap-2 text-small">
                  {words.map((w) => (
                    <li key={w.word} className="rounded-full bg-surface px-3 py-1">
                      {w.word}
                      {w.translation && ` — ${w.translation}`}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {error && (
              <p role="alert" className="whitespace-pre-line rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <Button disabled={saving || (form.homework !== null && !dueDate)} onClick={finish}>
                Завершить урок
              </Button>
              <Button variant="secondary" disabled={saving} onClick={onCancel}>
                Отмена
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MaterialNote({ material, gameResult }: { material: Material | undefined; gameResult: boolean | null }) {
  if (!material) return <p className="text-small text-text-secondary">Этого материала больше нет в библиотеке</p>;
  const text =
    material.kind === "warmup"
      ? `На сцене разминка «${material.title}»`
      : material.kind === "video"
        ? `Видео «${material.title}» на сцене не показывается: при демонстрации оно тормозит. Открыть его ученику по ссылке можно будет отсюда`
        : `На сцене игра «${material.title}»: играйте в окне сцены, итог сохранится ученику этого урока`;
  return (
    <div className="flex flex-col gap-1 rounded-card border border-border p-4 text-small">
      <p>{text}</p>
      {material.kind === "game" && gameResult === true && <p className="text-green-700">Итог игры сохранён</p>}
      {material.kind === "game" && gameResult === false && (
        <p role="alert" className="text-danger">
          Итог игры не сохранился: игра прислала его не по формату
        </p>
      )}
    </div>
  );
}

function Note({ lessonId, initial }: { lessonId: string; initial: string }) {
  const [note, setNote] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(initial);

  function save() {
    const text = latest.current;
    setStatus("saving");
    routerClient.teacher.lessonMode.saveNote.mutate({ lessonId, note: text }).then(
      () => setStatus(latest.current === text ? "saved" : "saving"),
      () => setStatus("failed"),
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <label htmlFor="lesson-note" className="text-h3 font-semibold">
        Заметка к уроку
      </label>
      <textarea
        id="lesson-note"
        value={note}
        maxLength={5000}
        rows={5}
        onChange={(e) => {
          setNote(e.target.value);
          latest.current = e.target.value;
          setStatus("idle");
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(save, NOTE_PAUSE_MS);
        }}
        className="rounded-control border border-border bg-bg px-3 py-2"
      />
      <p className="text-small text-text-secondary" aria-live="polite">
        {status === "saved" ? "Заметка сохранена" : status === "saving" ? "Сохраняется…" : status === "failed" ? "Не получилось сохранить заметку" : ""}
      </p>
    </section>
  );
}

