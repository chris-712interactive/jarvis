"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getSpeechRecognitionConstructor,
  type SpeechRecognitionLike,
} from "@/lib/speech/browser";

export function usePushToTalk(options: {
  enabled: boolean;
  onTranscript: (text: string, meta: { final: boolean }) => void;
  onComplete?: (text: string) => void;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalBufferRef = useRef("");
  const wantListenRef = useRef(false);
  const sendOnEndRef = useRef(true);
  const onTranscriptRef = useRef(options.onTranscript);
  const onCompleteRef = useRef(options.onComplete);
  onTranscriptRef.current = options.onTranscript;
  onCompleteRef.current = options.onComplete;

  useEffect(() => {
    setSupported(Boolean(getSpeechRecognitionConstructor()));
  }, []);

  const stop = useCallback((opts?: { send?: boolean }) => {
    wantListenRef.current = false;
    sendOnEndRef.current = opts?.send !== false;
    if (opts?.send === false) {
      finalBufferRef.current = "";
    }
    const recognition = recognitionRef.current;
    if (recognition) {
      try {
        recognition.stop();
      } catch {
        // already stopped
      }
    }
    setListening(false);
  }, []);

  const start = useCallback(() => {
    if (!options.enabled) return;
    setSpeechError(null);

    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      setSpeechError("Voice input needs Chrome or Edge on this device.");
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
    finalBufferRef.current = "";
    wantListenRef.current = true;
    sendOnEndRef.current = true;

    recognition.onresult = (event) => {
      let interim = "";
      let finals = finalBufferRef.current;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const chunk = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finals = `${finals} ${chunk}`.trim();
          finalBufferRef.current = finals;
          onTranscriptRef.current(finals, { final: true });
        } else {
          interim += chunk;
        }
      }
      const live = `${finals} ${interim}`.trim();
      if (live) onTranscriptRef.current(live, { final: false });
    };

    recognition.onerror = (event) => {
      if (event.error === "aborted" || event.error === "no-speech") return;
      if (event.error === "not-allowed") {
        setSpeechError("Microphone permission blocked. Allow mic access and try again.");
      } else {
        setSpeechError(`Voice error: ${event.error}`);
      }
      wantListenRef.current = false;
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
      const text = finalBufferRef.current.trim();
      if (wantListenRef.current) {
        try {
          recognition.start();
          setListening(true);
          return;
        } catch {
          wantListenRef.current = false;
        }
      }
      if (sendOnEndRef.current && text) {
        onCompleteRef.current?.(text);
      }
      sendOnEndRef.current = true;
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setSpeechError("Could not start microphone.");
      wantListenRef.current = false;
      setListening(false);
    }
  }, [options.enabled]);

  useEffect(() => {
    return () => {
      wantListenRef.current = false;
      sendOnEndRef.current = false;
      try {
        recognitionRef.current?.abort();
      } catch {
        // ignore
      }
    };
  }, []);

  const toggle = useCallback(() => {
    if (listening || wantListenRef.current) {
      stop({ send: true });
      return;
    }
    start();
  }, [listening, start, stop]);

  return {
    supported,
    listening,
    speechError,
    start,
    stop,
    toggle,
  };
}
