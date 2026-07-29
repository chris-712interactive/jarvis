"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_WAKE_WORD,
  appendSpeechFinal,
  extractWakeCommand,
  getSpeechRecognitionConstructor,
  sanitizeVoiceCommand,
  type SpeechRecognitionLike,
} from "@/lib/speech/browser";

export type AmbientPhase = "off" | "watching" | "armed" | "capturing";

type Options = {
  enabled: boolean;
  paused?: boolean;
  wakeWord?: string;
  onListeningChange?: (listening: boolean) => void;
  onPhaseChange?: (phase: AmbientPhase) => void;
  onPartialCommand?: (text: string) => void;
  onCommand?: (text: string) => void;
  onWake?: () => void;
};

const CAPTURE_SILENCE_MS = 1700;
const ARMED_TIMEOUT_MS = 5000;

export function useWakeWordAmbient(options: Options) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [phase, setPhase] = useState<AmbientPhase>("off");
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [partial, setPartial] = useState("");

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const wantListenRef = useRef(false);
  const phaseRef = useRef<AmbientPhase>("off");
  /** Committed finals only — never append interim hypotheses. */
  const finalBufferRef = useRef("");
  /** Latest interim hypothesis for the live utterance. */
  const interimRef = useRef("");
  const captureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeWordRef = useRef(options.wakeWord || DEFAULT_WAKE_WORD);
  const pausedRef = useRef(Boolean(options.paused));

  const onListeningChangeRef = useRef(options.onListeningChange);
  const onPhaseChangeRef = useRef(options.onPhaseChange);
  const onPartialCommandRef = useRef(options.onPartialCommand);
  const onCommandRef = useRef(options.onCommand);
  const onWakeRef = useRef(options.onWake);

  onListeningChangeRef.current = options.onListeningChange;
  onPhaseChangeRef.current = options.onPhaseChange;
  onPartialCommandRef.current = options.onPartialCommand;
  onCommandRef.current = options.onCommand;
  onWakeRef.current = options.onWake;
  wakeWordRef.current = options.wakeWord || DEFAULT_WAKE_WORD;
  pausedRef.current = Boolean(options.paused);

  const setPhaseSafe = useCallback((next: AmbientPhase) => {
    phaseRef.current = next;
    setPhase(next);
    onPhaseChangeRef.current?.(next);
  }, []);

  const clearTimers = useCallback(() => {
    if (captureTimerRef.current) {
      clearTimeout(captureTimerRef.current);
      captureTimerRef.current = null;
    }
    if (armedTimerRef.current) {
      clearTimeout(armedTimerRef.current);
      armedTimerRef.current = null;
    }
  }, []);

  const clearBuffers = useCallback(() => {
    finalBufferRef.current = "";
    interimRef.current = "";
    setPartial("");
  }, []);

  const publishLive = useCallback((finalText: string, interimText: string) => {
    const live = sanitizeVoiceCommand(`${finalText} ${interimText}`.trim());
    setPartial(live);
    onPartialCommandRef.current?.(live);
    return live;
  }, []);

  const liveCommand = useCallback(() => {
    return sanitizeVoiceCommand(
      `${finalBufferRef.current} ${interimRef.current}`.trim(),
    );
  }, []);

  const finishCommand = useCallback(() => {
    clearTimers();
    const command = liveCommand();
    clearBuffers();
    if (command) {
      onCommandRef.current?.(command);
    }
    if (wantListenRef.current) {
      setPhaseSafe("watching");
    } else {
      setPhaseSafe("off");
    }
  }, [clearBuffers, clearTimers, liveCommand, setPhaseSafe]);

  const armCapture = useCallback(() => {
    clearTimers();
    clearBuffers();
    setPhaseSafe("armed");
    onWakeRef.current?.();
    armedTimerRef.current = setTimeout(() => {
      if (phaseRef.current === "armed") {
        clearBuffers();
        setPhaseSafe(wantListenRef.current ? "watching" : "off");
      }
    }, ARMED_TIMEOUT_MS);
  }, [clearBuffers, clearTimers, setPhaseSafe]);

  const scheduleCaptureFinalize = useCallback(() => {
    if (captureTimerRef.current) clearTimeout(captureTimerRef.current);
    captureTimerRef.current = setTimeout(() => {
      finishCommand();
    }, CAPTURE_SILENCE_MS);
  }, [finishCommand]);

  const beginCapturing = useCallback(
    (seed: string, isFinal: boolean) => {
      const cleaned = seed.trim();
      if (!cleaned) return;
      if (isFinal) {
        finalBufferRef.current = appendSpeechFinal("", cleaned);
        interimRef.current = "";
      } else {
        finalBufferRef.current = "";
        interimRef.current = cleaned;
      }
      publishLive(finalBufferRef.current, interimRef.current);
      setPhaseSafe("capturing");
      clearTimers();
      scheduleCaptureFinalize();
    },
    [clearTimers, publishLive, scheduleCaptureFinalize, setPhaseSafe],
  );

  const handleTranscript = useCallback(
    (transcript: string, isFinal: boolean) => {
      if (pausedRef.current) return;
      const wakeWord = wakeWordRef.current;
      const current = phaseRef.current;
      const chunk = transcript.trim();
      if (!chunk) return;

      if (current === "watching") {
        const extracted = extractWakeCommand(chunk, wakeWord);
        if (!extracted.heard) return;

        if (extracted.command) {
          onWakeRef.current?.();
          beginCapturing(extracted.command, isFinal);
          return;
        }

        armCapture();
        return;
      }

      if (current === "armed") {
        const extracted = extractWakeCommand(chunk, wakeWord);
        const command = extracted.heard ? extracted.command : chunk;
        if (!command) return;
        beginCapturing(command, isFinal);
        return;
      }

      if (current === "capturing") {
        const extracted = extractWakeCommand(chunk, wakeWord);
        const spoken = extracted.heard ? extracted.command : chunk;
        if (!spoken) {
          scheduleCaptureFinalize();
          return;
        }

        if (isFinal) {
          finalBufferRef.current = appendSpeechFinal(
            finalBufferRef.current,
            spoken,
          );
          interimRef.current = "";
        } else {
          // Replace interim hypothesis — do not append (Chrome stutter source).
          interimRef.current = spoken;
        }

        publishLive(finalBufferRef.current, interimRef.current);
        scheduleCaptureFinalize();
      }
    },
    [armCapture, beginCapturing, publishLive, scheduleCaptureFinalize],
  );

  const stop = useCallback(() => {
    wantListenRef.current = false;
    clearTimers();
    clearBuffers();
    const recognition = recognitionRef.current;
    if (recognition) {
      try {
        recognition.abort();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    setListening(false);
    onListeningChangeRef.current?.(false);
    setPhaseSafe("off");
  }, [clearBuffers, clearTimers, setPhaseSafe]);

  const start = useCallback(() => {
    setSpeechError(null);
    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      setSpeechError("Ambient listening needs Chrome or Edge.");
      return;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    wantListenRef.current = true;
    clearBuffers();
    setPhaseSafe("watching");

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const chunk = result[0]?.transcript?.trim() ?? "";
        if (!chunk) continue;
        handleTranscript(chunk, result.isFinal);
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "aborted" || event.error === "no-speech") return;
      if (event.error === "not-allowed") {
        setSpeechError("Microphone permission blocked for ambient listening.");
        wantListenRef.current = false;
        setListening(false);
        onListeningChangeRef.current?.(false);
        setPhaseSafe("off");
        return;
      }
      setSpeechError(`Voice error: ${event.error}`);
    };

    recognition.onend = () => {
      setListening(false);
      onListeningChangeRef.current?.(false);

      // If Chrome ends the session mid-capture, flush the command.
      if (
        (phaseRef.current === "capturing" || phaseRef.current === "armed") &&
        liveCommand()
      ) {
        finishCommand();
      }

      if (!wantListenRef.current) {
        setPhaseSafe("off");
        return;
      }
      // Chrome ends sessions often — restart while ambient mode is on.
      window.setTimeout(() => {
        if (!wantListenRef.current || !recognitionRef.current) return;
        try {
          recognitionRef.current.start();
          setListening(true);
          onListeningChangeRef.current?.(true);
          if (phaseRef.current === "off") setPhaseSafe("watching");
        } catch {
          // retry once more shortly
          window.setTimeout(() => {
            if (!wantListenRef.current || !recognitionRef.current) return;
            try {
              recognitionRef.current.start();
              setListening(true);
              onListeningChangeRef.current?.(true);
            } catch {
              setSpeechError("Ambient microphone stopped. Toggle Ambient to retry.");
              wantListenRef.current = false;
              setPhaseSafe("off");
            }
          }, 400);
        }
      }, 220);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
      onListeningChangeRef.current?.(true);
    } catch {
      setSpeechError("Could not start ambient microphone.");
      wantListenRef.current = false;
      setListening(false);
      setPhaseSafe("off");
    }
  }, [
    clearBuffers,
    finishCommand,
    handleTranscript,
    liveCommand,
    setPhaseSafe,
  ]);

  useEffect(() => {
    setSupported(Boolean(getSpeechRecognitionConstructor()));
  }, []);

  useEffect(() => {
    if (options.enabled && !options.paused) {
      if (!wantListenRef.current) start();
      return;
    }
    if (!options.enabled) {
      stop();
      return;
    }
    // Paused (e.g. model streaming): keep mic session but drop in-flight capture.
    if (options.paused && wantListenRef.current) {
      clearTimers();
      clearBuffers();
      if (phaseRef.current !== "watching" && phaseRef.current !== "off") {
        setPhaseSafe("watching");
      }
    }
  }, [
    options.enabled,
    options.paused,
    start,
    stop,
    clearTimers,
    clearBuffers,
    setPhaseSafe,
  ]);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  return {
    supported,
    listening,
    phase,
    partial,
    speechError,
    start,
    stop,
  };
}
