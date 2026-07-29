"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_WAKE_WORD,
  extractWakeCommand,
  getSpeechRecognitionConstructor,
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
  const commandBufferRef = useRef("");
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

  const finishCommand = useCallback(() => {
    clearTimers();
    const command = commandBufferRef.current.trim();
    commandBufferRef.current = "";
    setPartial("");
    if (command) {
      onCommandRef.current?.(command);
    }
    if (wantListenRef.current) {
      setPhaseSafe("watching");
    } else {
      setPhaseSafe("off");
    }
  }, [clearTimers, setPhaseSafe]);

  const armCapture = useCallback(() => {
    clearTimers();
    setPhaseSafe("armed");
    onWakeRef.current?.();
    armedTimerRef.current = setTimeout(() => {
      if (phaseRef.current === "armed") {
        commandBufferRef.current = "";
        setPartial("");
        setPhaseSafe(wantListenRef.current ? "watching" : "off");
      }
    }, ARMED_TIMEOUT_MS);
  }, [clearTimers, setPhaseSafe]);

  const scheduleCaptureFinalize = useCallback(() => {
    if (captureTimerRef.current) clearTimeout(captureTimerRef.current);
    captureTimerRef.current = setTimeout(() => {
      finishCommand();
    }, CAPTURE_SILENCE_MS);
  }, [finishCommand]);

  const handleTranscript = useCallback(
    (transcript: string, isFinal: boolean) => {
      if (pausedRef.current) return;
      const wakeWord = wakeWordRef.current;
      const current = phaseRef.current;

      if (current === "watching") {
        const extracted = extractWakeCommand(transcript, wakeWord);
        if (!extracted.heard) return;

        if (extracted.command) {
          commandBufferRef.current = extracted.command;
          setPartial(extracted.command);
          onPartialCommandRef.current?.(extracted.command);
          setPhaseSafe("capturing");
          onWakeRef.current?.();
          if (isFinal) scheduleCaptureFinalize();
          return;
        }

        armCapture();
        return;
      }

      if (current === "armed") {
        const extracted = extractWakeCommand(transcript, wakeWord);
        const command = extracted.heard
          ? extracted.command
          : transcript.trim();
        if (!command) return;
        commandBufferRef.current = command;
        setPartial(command);
        onPartialCommandRef.current?.(command);
        setPhaseSafe("capturing");
        clearTimers();
        if (isFinal) scheduleCaptureFinalize();
        return;
      }

      if (current === "capturing") {
        const extracted = extractWakeCommand(transcript, wakeWord);
        const next = extracted.heard
          ? extracted.command || commandBufferRef.current
          : `${commandBufferRef.current} ${transcript}`.trim();
        commandBufferRef.current = next;
        setPartial(next);
        onPartialCommandRef.current?.(next);
        if (isFinal) scheduleCaptureFinalize();
      }
    },
    [armCapture, clearTimers, scheduleCaptureFinalize, setPhaseSafe],
  );

  const stop = useCallback(() => {
    wantListenRef.current = false;
    clearTimers();
    commandBufferRef.current = "";
    setPartial("");
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
  }, [clearTimers, setPhaseSafe]);

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
    commandBufferRef.current = "";
    setPartial("");
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
  }, [handleTranscript, setPhaseSafe]);

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
      commandBufferRef.current = "";
      setPartial("");
      if (phaseRef.current !== "watching" && phaseRef.current !== "off") {
        setPhaseSafe("watching");
      }
    }
  }, [options.enabled, options.paused, start, stop, clearTimers, setPhaseSafe]);

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
