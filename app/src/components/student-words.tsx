"use client";

import { useId, useState, useSyncExternalStore } from "react";

type Word = { id: string; word: string; translation: string | null; example: string | null };

/**
 * «Мои слова» (#236): the student's words, newest first, searched by word or
 * translation. «Послушать» speaks a word with the device's English voice —
 * on Android and in Chrome that is Google's, on an iPhone or a Mac Apple's —
 * and is not shown where the browser has no speech synthesis.
 */
export function StudentWords({ words }: { words: Word[] }) {
  const search = useId();
  const [query, setQuery] = useState("");
  // Known in the browser only: the server renders without «Послушать».
  const canSpeak = useSyncExternalStore(
    noChange,
    () => "speechSynthesis" in window,
    () => false,
  );

  if (words.length === 0) {
    return (
      <div className="rounded-task border border-border bg-accent-50 px-6 py-10 text-center">
        <p className="text-answer font-semibold text-accent-900">Слов пока нет</p>
        <p className="mt-2 text-small text-accent-900">Новые слова появятся здесь после урока</p>
      </div>
    );
  }

  const needle = query.trim().toLowerCase();
  const shown = needle
    ? words.filter((w) => w.word.toLowerCase().includes(needle) || (w.translation ?? "").toLowerCase().includes(needle))
    : words;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor={search} className="text-small text-text-secondary">
          Поиск
        </label>
        <input
          id={search}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-12 rounded-task border-2 border-border bg-bg px-4 text-answer"
        />
      </div>
      {shown.length === 0 ? (
        <p className="text-answer text-text-secondary">Ничего не нашлось</p>
      ) : (
        <ul aria-label="Мои слова" className="flex flex-col gap-2">
          {shown.map((w) => (
            <li key={w.id} className="flex items-start justify-between gap-3 rounded-task border border-border bg-bg px-4 py-3">
              <div className="flex flex-col gap-1">
                <p className="text-answer">
                  <span className="font-bold">{w.word}</span>
                  {w.translation && <span className="text-text-secondary"> — {w.translation}</span>}
                </p>
                {w.example && <p className="text-small text-text-secondary">{w.example}</p>}
              </div>
              {canSpeak && (
                <button
                  type="button"
                  onClick={() => speak(w.word)}
                  className="h-10 shrink-0 rounded-task border-2 border-border px-3 text-small font-semibold hover:bg-surface"
                >
                  Послушать
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const noChange = () => () => undefined;

/** The best English voice the device has: a Google or natural one first, then any English one; else the browser's default for English. */
function speak(text: string) {
  const synth = window.speechSynthesis;
  const english = synth.getVoices().filter((voice) => voice.lang.toLowerCase().startsWith("en"));
  const rank = (voice: SpeechSynthesisVoice) =>
    (/google|natural|premium|enhanced/i.test(voice.name) ? 0 : 2) + (voice.lang.toLowerCase() === "en-us" || voice.lang.toLowerCase() === "en-gb" ? 0 : 1);
  const voice = [...english].sort((a, b) => rank(a) - rank(b))[0];
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = voice?.lang ?? "en-US";
  if (voice) utterance.voice = voice;
  utterance.rate = 0.9;
  synth.cancel();
  synth.speak(utterance);
}
