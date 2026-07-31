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

let voicesCache: SpeechSynthesisVoice[] | null = null;
let voicesLoadPromise: Promise<SpeechSynthesisVoice[]> | null = null;
let speechUnlocked = false;

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

export function isSpeechSynthesisSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
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

  arr = collapseDistantPhraseRepeats(arr);

  if (arr.length > 48) {
    const unique = new Set(arr.map((word) => word.toLowerCase()));
    if (unique.size / arr.length < 0.35) {
      arr = arr.slice(0, 48);
    }
  }

  return arr.join(" ").trim();
}

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

export function sanitizeVoiceCommand(text: string) {
  return collapseSpeechRepeats(text);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractWakeCommand(
  transcript: string,
  wakeWord = "jarvis",
): { heard: boolean; command: string } {
  const normalized = normalizeSpeech(transcript);
  if (!normalized) return { heard: false, command: "" };

  const word = escapeRegExp(normalizeSpeech(wakeWord) || "jarvis");
  const pattern = new RegExp(
    `^(?:(?:hey|ok|okay|hi)\\s+)?${word}\\b`,
    "i",
  );
  const match = pattern.exec(normalized);
  if (!match) {
    return { heard: false, command: "" };
  }

  const command = normalized.slice(match[0].length).trim();
  return { heard: true, command };
}

export function stopSpeaking() {
  if (!isSpeechSynthesisSupported()) return;
  try {
    window.speechSynthesis.cancel();
    // Chrome often stays paused after cancel; resume so the next speak can start.
    window.speechSynthesis.resume();
  } catch {
    // ignore
  }
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** Chrome loads voices async; first getVoices() is often empty. */
export function loadSpeechVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!isSpeechSynthesisSupported()) return Promise.resolve([]);
  if (voicesCache && voicesCache.length > 0) {
    return Promise.resolve(voicesCache);
  }
  if (voicesLoadPromise) return voicesLoadPromise;

  voicesLoadPromise = new Promise((resolve) => {
    const finish = (voices: SpeechSynthesisVoice[]) => {
      if (voices.length > 0) {
        voicesCache = voices;
      }
      voicesLoadPromise = null;
      resolve(voices);
    };

    const existing = window.speechSynthesis.getVoices();
    if (existing.length > 0) {
      finish(existing);
      return;
    }

    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      window.speechSynthesis.removeEventListener("voiceschanged", onChange);
      finish(window.speechSynthesis.getVoices());
    };
    const onChange = () => done();
    window.speechSynthesis.addEventListener("voiceschanged", onChange);
    void window.speechSynthesis.getVoices();
    // Keep this short so Test voice stays inside the user-activation window.
    window.setTimeout(done, 250);
  });

  return voicesLoadPromise;
}

function pickVoice(voices: SpeechSynthesisVoice[]) {
  if (voices.length === 0) return null;
  const english = voices.filter((voice) =>
    /^en([-_]|$)/i.test(voice.lang || ""),
  );
  const pool = english.length > 0 ? english : voices;

  // Prefer local/device voices. Skip Chrome "Google" online voices — often silent.
  const local = pool.filter(
    (voice) => voice.localService && !/google/i.test(voice.name),
  );
  if (local.length > 0) {
    return (
      local.find((voice) =>
        /samantha|daniel|karen|moira|reed|aaron|flo|microsoft|zira|david/i.test(
          voice.name,
        ),
      ) ?? local[0]
    );
  }

  const nonGoogle = pool.filter((voice) => !/google/i.test(voice.name));
  return nonGoogle[0] ?? pool[0] ?? null;
}

/**
 * Must run synchronously inside a click/tap handler.
 * Resumes Chrome's often-stuck paused state, loads voices, and primes TTS.
 */
export function unlockSpeechSynthesis() {
  if (!isSpeechSynthesisSupported()) return;
  try {
    void loadSpeechVoices();
    window.speechSynthesis.resume();

    if (speechUnlocked) return;

    const warm = new SpeechSynthesisUtterance(" ");
    warm.volume = 0;
    warm.rate = 2;
    warm.pitch = 1;
    warm.onend = () => {
      speechUnlocked = true;
    };
    warm.onerror = () => {
      speechUnlocked = true;
    };
    window.speechSynthesis.speak(warm);
    speechUnlocked = true;
  } catch {
    // ignore
  }
}

/**
 * Soft unlock on a user gesture: silent warm-up + load voices + resume.
 * Call this from click handlers before any await.
 */
export function primeSpeechSynthesis() {
  if (!isSpeechSynthesisSupported()) return;
  unlockSpeechSynthesis();
}

type SpeakChunkOptions = {
  voice?: SpeechSynthesisVoice | null;
  /** How long to wait for onstart before failing/retrying. */
  startTimeoutMs?: number;
};

function speakChunk(
  text: string,
  options: SpeakChunkOptions = {},
): Promise<void> {
  const voice = options.voice ?? null;
  const startTimeoutMs = options.startTimeoutMs ?? 2_000;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      window.clearInterval(resumeTimer);
      window.clearTimeout(startTimer);
      window.clearTimeout(endFailsafe);
      if (err) reject(err);
      else resolve();
    };

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.02;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.lang = voice?.lang || "en-US";
    if (voice) utterance.voice = voice;

    let started = false;
    utterance.onstart = () => {
      started = true;
      speechUnlocked = true;
      try {
        window.speechSynthesis.resume();
      } catch {
        // ignore
      }
    };
    utterance.onend = () => finish();
    utterance.onerror = (event) => {
      const code = String(event.error || "");
      if (code === "interrupted" || code === "canceled") {
        finish();
        return;
      }
      if (code === "not-allowed") {
        finish(
          new Error(
            "speechSynthesis not-allowed — click Test voice again (Chrome needs a user gesture / Sound allowed for this site).",
          ),
        );
        return;
      }
      finish(new Error(`speechSynthesis error: ${code || "unknown"}`));
    };

    // Chrome can freeze in paused=true; keep nudging while this chunk is live.
    const resumeTimer = window.setInterval(() => {
      try {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
      } catch {
        // ignore
      }
    }, 250);

    const startTimer = window.setTimeout(() => {
      if (!started) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          // ignore
        }
        finish(new Error("speechSynthesis never started"));
      }
    }, startTimeoutMs);

    // Absolute cap so a hung utterance cannot block the uplink forever.
    const endFailsafe = window.setTimeout(
      () => {
        if (started) finish();
      },
      Math.min(45_000, Math.max(8_000, text.length * 80 + 4_000)),
    );

    try {
      window.speechSynthesis.resume();
      window.speechSynthesis.speak(utterance);
      window.setTimeout(() => {
        try {
          if (!started && window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
          }
        } catch {
          // ignore
        }
      }, 40);
    } catch (error) {
      finish(
        error instanceof Error
          ? error
          : new Error("speechSynthesis.speak failed"),
      );
    }
  });
}

async function speakChunkWithRetry(
  text: string,
  voice: SpeechSynthesisVoice | null,
) {
  try {
    await speakChunk(text, { voice, startTimeoutMs: 2_000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/never started|not-allowed/i.test(message)) {
      throw error;
    }

    // Chrome recovery: hard reset queue, drop custom voice, speak again.
    stopSpeaking();
    await wait(180);
    try {
      window.speechSynthesis.resume();
    } catch {
      // ignore
    }
    await speakChunk(text, { voice: null, startTimeoutMs: 3_500 });
  }
}

/** Split long replies so Chrome doesn't drop the utterance. */
function chunkForSpeech(text: string) {
  const max = 160;
  if (text.length <= max) return [text];

  const parts: string[] = [];
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
  let buf = "";
  for (const sentence of sentences) {
    const next = sentence.trim();
    if (!next) continue;
    if ((buf + " " + next).trim().length > max && buf) {
      parts.push(buf.trim());
      buf = next;
    } else {
      buf = `${buf} ${next}`.trim();
    }
  }
  if (buf) parts.push(buf.trim());
  return parts.length > 0 ? parts : [text];
}

async function voicesForSpeak() {
  // Prefer sync voices so Test voice can speak inside the click turn.
  const sync = window.speechSynthesis.getVoices();
  if (sync.length > 0) {
    voicesCache = sync;
    return sync;
  }
  const loaded = await Promise.race([
    loadSpeechVoices(),
    wait(300).then(() => window.speechSynthesis.getVoices()),
  ]);
  return loaded;
}

/**
 * Speak text via browser TTS.
 * Call unlockSpeechSynthesis()/primeSpeechSynthesis() from the click handler
 * before any await when possible (Test voice / Speak toggle).
 */
export async function speakText(
  text: string,
  options: { forceDefaultVoice?: boolean } = {},
): Promise<void> {
  if (!isSpeechSynthesisSupported()) {
    throw new Error("This browser has no speechSynthesis (try Chrome or Edge).");
  }

  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return;

  // Sync voice pick when possible so the first speak() can run in this turn.
  let voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    voicesCache = voices;
  }

  const chunks = chunkForSpeech(clean);
  if (chunks.length === 0) return;

  // Always clear prior queue (including silent unlock warm-up) so Chrome
  // doesn't stall behind a stuck/paused utterance.
  stopSpeaking();
  await wait(100);
  try {
    window.speechSynthesis.resume();
  } catch {
    // ignore
  }

  if (voices.length === 0) {
    voices = await voicesForSpeak();
  }

  let voice = options.forceDefaultVoice ? null : pickVoice(voices);

  for (let i = 0; i < chunks.length; i += 1) {
    if (i > 0 && !voice && !options.forceDefaultVoice) {
      const refreshed = window.speechSynthesis.getVoices();
      if (refreshed.length > 0) {
        voicesCache = refreshed;
        voice = pickVoice(refreshed);
      }
    }
    await speakChunkWithRetry(chunks[i], voice);
  }
}

export const AMBIENT_STORAGE_KEY = "jarvis.ambient.enabled";
export const WAKE_WORD_STORAGE_KEY = "jarvis.wake.word";
export const SPEAK_REPLIES_STORAGE_KEY = "jarvis.speak.replies";
export const DEFAULT_WAKE_WORD = "jarvis";

/** Strip light markdown so TTS sounds less like source code. */
export function textForSpeech(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}
