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

/** Merge a new final STT chunk without duplicating overlapping text. */
export function appendSpeechFinal(buffer: string, chunk: string) {
  const existing = buffer.replace(/\s+/g, " ").trim();
  const next = chunk.replace(/\s+/g, " ").trim();
  if (!next) return existing;
  if (!existing) return next;

  const existingLower = existing.toLowerCase();
  const nextLower = next.toLowerCase();
  if (existingLower === nextLower) return existing;
  if (existingLower.endsWith(nextLower)) return existing;
  if (nextLower.startsWith(existingLower)) return next;
  if (existingLower.includes(nextLower) && next.split(/\s+/).length >= 3) {
    return existing;
  }
  return `${existing} ${next}`.trim();
}

function sameWordsIgnoreCase(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].toLowerCase() !== b[i].toLowerCase()) return false;
  }
  return true;
}

/**
 * Collapse Chrome Web Speech stutter loops like
 * "for Forge for Forge for Forge I need I need …"
 */
export function collapseSpeechRepeats(text: string) {
  const raw = text.replace(/\s+/g, " ").trim();
  if (!raw) return "";

  // Drop consecutive duplicate words first.
  const words: string[] = [];
  for (const word of raw.split(" ")) {
    if (!word) continue;
    if (
      words.length > 0 &&
      words[words.length - 1].toLowerCase() === word.toLowerCase()
    ) {
      continue;
    }
    words.push(word);
  }

  let arr = words;
  let changed = true;
  while (changed) {
    changed = false;
    const maxN = Math.min(20, Math.floor(arr.length / 2));
    for (let n = maxN; n >= 2; n -= 1) {
      const next: string[] = [];
      let i = 0;
      while (i < arr.length) {
        if (i + 2 * n <= arr.length) {
          const phrase = arr.slice(i, i + n);
          let repeats = 1;
          while (
            i + (repeats + 1) * n <= arr.length &&
            sameWordsIgnoreCase(
              phrase,
              arr.slice(i + repeats * n, i + (repeats + 1) * n),
            )
          ) {
            repeats += 1;
          }
          if (repeats > 1) {
            next.push(...phrase);
            i += repeats * n;
            changed = true;
            continue;
          }
        }
        next.push(arr[i]);
        i += 1;
      }
      arr = next;
      if (changed) break;
    }
  }

  // STT often restarts mid-sentence leaving near-duplicate spans, not only adjacent loops.
  arr = collapseDistantPhraseRepeats(arr);

  if (arr.length > 48) {
    const unique = new Set(arr.map((word) => word.toLowerCase()));
    if (unique.size / arr.length < 0.35) {
      arr = arr.slice(0, 48);
    }
  }

  return arr.join(" ").trim();
}

/** Remove a later copy of a long phrase when STT echoed the same request again. */
function collapseDistantPhraseRepeats(words: string[]) {
  let arr = words;
  let guard = 0;
  while (guard < 8) {
    guard += 1;
    let removed = false;
    const maxLen = Math.min(24, Math.floor(arr.length / 2));
    outer: for (let len = maxLen; len >= 5; len -= 1) {
      for (let i = 0; i + len < arr.length; i += 1) {
        const phrase = arr.slice(i, i + len);
        for (let j = i + len; j + len <= arr.length; j += 1) {
          if (sameWordsIgnoreCase(phrase, arr.slice(j, j + len))) {
            arr = [...arr.slice(0, j), ...arr.slice(j + len)];
            removed = true;
            break outer;
          }
        }
      }
    }
    if (!removed) break;
  }
  return arr;
}

/** Final cleanup before a voice command is sent to chat. */
export function sanitizeVoiceCommand(text: string) {
  return collapseSpeechRepeats(text);
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

/**
 * Speak text via browser TTS.
 * Chrome often stalls speechSynthesis and skips onend — keep a resume tick
 * and a hard timeout so callers never stay locked in a "speaking" state.
 */
export function speakText(text: string): Promise<void> {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    return Promise.resolve();
  }
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return Promise.resolve();

  stopSpeaking();

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearInterval(resumeTimer);
      window.clearTimeout(failsafeTimer);
      resolve();
    };

    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = 1.05;
    utterance.pitch = 1;
    utterance.onend = () => finish();
    utterance.onerror = () => finish();

    // Chrome bug: synthesis silently pauses unless periodically resumed.
    const resumeTimer = window.setInterval(() => {
      try {
        if (window.speechSynthesis.paused || window.speechSynthesis.pending) {
          window.speechSynthesis.resume();
        }
      } catch {
        // ignore
      }
    }, 250);

    // ~60ms/char + buffer, clamped so short questions still unlock quickly.
    const ms = Math.min(45_000, Math.max(4_000, clean.length * 60 + 2_000));
    const failsafeTimer = window.setTimeout(() => {
      stopSpeaking();
      finish();
    }, ms);

    try {
      window.speechSynthesis.speak(utterance);
      window.speechSynthesis.resume();
    } catch {
      finish();
    }
  });
}

export const AMBIENT_STORAGE_KEY = "jarvis.ambient.enabled";
export const WAKE_WORD_STORAGE_KEY = "jarvis.wake.word";
export const DEFAULT_WAKE_WORD = "jarvis";
