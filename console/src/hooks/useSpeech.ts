import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Browser speech: the microphone through SpeechRecognition and reading aloud
 * through speechSynthesis. Both are optional browser features (Firefox has no
 * recognition), so every entry point is safe to call when one is missing and
 * the caller reads `canListen` / `canSpeak` to say so plainly.
 *
 * Recognition audio is handled by the browser's own speech service; nothing
 * here sends audio or text to our servers.
 */

export type ListenError = "blocked" | "no-speech" | "unavailable";

interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  isFinal: boolean;
  0: RecognitionAlternative;
}
interface RecognitionEvent {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResult };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type RecognitionCtor = new () => Recognition;

const recognitionCtor = (): RecognitionCtor | null => {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
};

const synthesis = (): SpeechSynthesis | null =>
  typeof window !== "undefined" && "speechSynthesis" in window
    ? window.speechSynthesis
    : null;

const toListenError = (code: string): ListenError | null => {
  if (code === "not-allowed" || code === "service-not-allowed") return "blocked";
  if (code === "no-speech") return "no-speech";
  if (code === "aborted") return null;
  return "unavailable";
};

export interface ListenHandlers {
  /** The final transcript of one utterance. */
  onHeard: (text: string) => void;
  /** Recognition stopped without a usable utterance. */
  onError?: (error: ListenError) => void;
}

export const useSpeech = () => {
  const canListen = useMemo(() => recognitionCtor() !== null, []);
  const canSpeak = useMemo(() => synthesis() !== null, []);

  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState("");
  const [listenError, setListenError] = useState<ListenError | null>(null);

  const recognitionRef = useRef<Recognition | null>(null);
  const pendingUtterances = useRef(0);
  // Bumped whenever the queue is cancelled, so a cancelled utterance's late
  // `end` event cannot fire a stale `onDone` (which would reopen the mic).
  const speechGeneration = useRef(0);

  const stopListening = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.abort();
      } catch {
        // Already stopped.
      }
    }
    setListening(false);
    setInterim("");
  }, []);

  const listen = useCallback(
    (handlers: ListenHandlers) => {
      const Ctor = recognitionCtor();
      if (!Ctor) {
        setListenError("unavailable");
        handlers.onError?.("unavailable");
        return;
      }
      stopListening();
      // Never listen to our own voice.
      speechGeneration.current += 1;
      pendingUtterances.current = 0;
      synthesis()?.cancel();
      setSpeaking(false);

      const recognition = new Ctor();
      recognition.lang = navigator.language || "en-US";
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      let heard = "";
      let failure: ListenError | null = null;

      recognition.onresult = (event) => {
        let partial = "";
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          if (result.isFinal) heard += result[0].transcript;
          else partial += result[0].transcript;
        }
        setInterim(partial);
      };
      recognition.onerror = (event) => {
        failure = toListenError(event.error);
      };
      recognition.onend = () => {
        if (recognitionRef.current !== recognition) return;
        recognitionRef.current = null;
        setListening(false);
        setInterim("");
        const text = heard.trim();
        if (text) {
          handlers.onHeard(text);
          return;
        }
        const error = failure ?? "no-speech";
        setListenError(error);
        handlers.onError?.(error);
      };

      recognitionRef.current = recognition;
      setListenError(null);
      setListening(true);
      try {
        recognition.start();
      } catch {
        recognitionRef.current = null;
        setListening(false);
        setListenError("unavailable");
        handlers.onError?.("unavailable");
      }
    },
    [stopListening],
  );

  /** Queue text to be read aloud. `onDone` fires once the whole queue is quiet. */
  const speak = useCallback((text: string, onDone?: () => void) => {
    const synth = synthesis();
    if (!synth || !text.trim()) {
      onDone?.();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = navigator.language || "en-US";
    utterance.rate = 1.05;
    const generation = speechGeneration.current;
    const finish = () => {
      if (generation !== speechGeneration.current) return;
      pendingUtterances.current = Math.max(0, pendingUtterances.current - 1);
      if (pendingUtterances.current === 0) {
        setSpeaking(false);
        onDone?.();
      }
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    pendingUtterances.current += 1;
    setSpeaking(true);
    synth.speak(utterance);
  }, []);

  const stopSpeaking = useCallback(() => {
    speechGeneration.current += 1;
    pendingUtterances.current = 0;
    synthesis()?.cancel();
    setSpeaking(false);
  }, []);

  useEffect(
    () => () => {
      stopListening();
      synthesis()?.cancel();
    },
    [stopListening],
  );

  return {
    canListen,
    canSpeak,
    listening,
    speaking,
    interim,
    listenError,
    listen,
    stopListening,
    speak,
    stopSpeaking,
  };
};
