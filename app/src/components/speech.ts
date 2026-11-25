"use client";

import { useSyncExternalStore } from "react";

// «Послушать» (#236, #323): a word spoken with the device's English voice —
// on Android and in Chrome that is Google's, on an iPhone or a Mac Apple's.
// Nothing is sent anywhere.

const noChange = () => () => undefined;

/** Whether the browser can speak; known in the browser only, so the server renders without «Послушать». */
export function useCanSpeak(): boolean {
  return useSyncExternalStore(
    noChange,
    () => "speechSynthesis" in window,
    () => false,
  );
}

/** The best English voice the device has: a Google or natural one first, then any English one; else the browser's default for English. */
export function speak(text: string) {
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
