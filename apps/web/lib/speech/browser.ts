"use client";

export type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

export type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

type SpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

export function getSpeechRecognitionConstructor() {
  if (typeof window === "undefined") return null;
  const speechWindow = window as SpeechWindow;
  return (
    speechWindow.SpeechRecognition ??
    speechWindow.webkitSpeechRecognition ??
    null
  );
}

export function isSpeechRecognitionSupported() {
  return Boolean(getSpeechRecognitionConstructor());
}

export function normalizeSpeech(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Detect wake phrase and any command text after it. */
export function extractWakeCommand(
  transcript: string,
  wakeWord = "jarvis",
): { heard: boolean; command: string } {
  const normalized = normalizeSpeech(transcript);
  if (!normalized) return { heard: false, command: "" };

  const word = escapeRegExp(normalizeSpeech(wakeWord) || "jarvis");
  const pattern = new RegExp(
    `\\b(?:(?:hey|ok|okay|hi)\\s+)?${word}\\b`,
    "i",
  );
  const match = pattern.exec(normalized);
  if (!match || match.index === undefined) {
    return { heard: false, command: "" };
  }

  const command = normalized.slice(match.index + match[0].length).trim();
  return { heard: true, command };
}

export function stopSpeaking() {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
}

/** Speak text via browser TTS. Returns a promise that resolves when done. */
export function speakText(text: string): Promise<void> {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    return Promise.resolve();
  }
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return Promise.resolve();

  stopSpeaking();

  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = 1.05;
    utterance.pitch = 1;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}

export const AMBIENT_STORAGE_KEY = "jarvis.ambient.enabled";
export const WAKE_WORD_STORAGE_KEY = "jarvis.wake.word";
export const DEFAULT_WAKE_WORD = "jarvis";
