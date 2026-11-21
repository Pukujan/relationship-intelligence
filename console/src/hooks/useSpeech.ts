import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Speech hook: prefers the VPS speech-gateway (Parakeet STT + Kokoro/Pocket-TTS)
 * over /api/speech/* so live voice works in every browser (including Brave and
 * Firefox) with natural voices. Falls back to browser SpeechRecognition /
 * speechSynthesis when the gateway is unavailable.
 */

export type ListenError = "blocked" | "no-speech" | "unavailable";

export interface SpeechEngineInfo {
  stt: string;
  tts: string;
}

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

const hasMicApi = (): boolean =>
  typeof navigator !== "undefined" &&
  Boolean(navigator.mediaDevices?.getUserMedia) &&
  typeof AudioContext !== "undefined";

const toListenError = (code: string): ListenError | null => {
  if (code === "not-allowed" || code === "service-not-allowed") return "blocked";
  if (code === "no-speech") return "no-speech";
  if (code === "aborted") return null;
  return "unavailable";
};

function downsampleTo16kWavBase64(chunks: Float32Array[], sourceRate: number): string {
  const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
  const merged = new Float32Array(totalLen);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.length;
  }
  const targetRate = 16_000;
  const ratio = sourceRate / targetRate;
  const outLen = Math.max(1, Math.floor(merged.length / ratio));
  const pcm = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(merged.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += merged[j] ?? 0;
    const sample = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  const dataBytes = pcm.byteLength;
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);
  const writeStr = (pos: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(pos + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataBytes, true);
  new Uint8Array(buf, 44).set(new Uint8Array(pcm.buffer));

  const bytes = new Uint8Array(buf);
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

export interface ListenHandlers {
  /** The final transcript of one utterance. */
  onHeard: (text: string) => void;
  /** Recognition stopped without a usable utterance. */
  onError?: (error: ListenError) => void;
}

export const useSpeech = () => {
  const [engine, setEngine] = useState<SpeechEngineInfo | null>(null);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState("");
  const [level, setLevel] = useState(0);
  const [listenError, setListenError] = useState<ListenError | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/speech/health", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { ok: false }))
      .then((data: { ok?: boolean; stt?: string; tts?: string }) => {
        if (!cancelled && data.ok) {
          setEngine({
            stt: data.stt ?? "parakeet",
            tts: data.tts ?? "kokoro",
          });
        }
      })
      .catch(() => {
        // Fall back to browser speech.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const canListen = useMemo(
    () => (Boolean(engine) && hasMicApi()) || recognitionCtor() !== null,
    [engine],
  );
  const canSpeak = useMemo(
    () => Boolean(engine) || synthesis() !== null,
    [engine],
  );

  const recognitionRef = useRef<Recognition | null>(null);
  const stopCaptureRef = useRef<((transcribe: boolean) => void) | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const pendingUtterances = useRef(0);
  const speechGeneration = useRef(0);
  const engineRef = useRef<SpeechEngineInfo | null>(null);
  engineRef.current = engine;

  const stopAudioPlayback = useCallback(() => {
    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  const stopListening = useCallback(() => {
    const stopCapture = stopCaptureRef.current;
    stopCaptureRef.current = null;
    if (stopCapture) {
      stopCapture(false);
    }
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
    setLevel(0);
  }, []);

  const listenWithGateway = useCallback(
    async (handlers: ListenHandlers) => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        setListening(false);
        setListenError("blocked");
        handlers.onError?.("blocked");
        return;
      }

      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const chunks: Float32Array[] = [];
      let heardSpeech = false;
      let lastSpeechAt = Date.now();
      const startedAt = Date.now();
      let finished = false;

      const finalize = async (shouldTranscribe: boolean) => {
        if (finished) return;
        finished = true;
        stopCaptureRef.current = null;
        try {
          processor.disconnect();
          source.disconnect();
          for (const track of stream.getTracks()) track.stop();
          void ctx.close();
        } catch {
          // ignore cleanup errors
        }
        setListening(false);
        setLevel(0);
        if (!shouldTranscribe || chunks.length === 0) {
          setInterim("");
          return;
        }
        setInterim("transcribing…");
        try {
          const audioBase64 = downsampleTo16kWavBase64(chunks, ctx.sampleRate);
          const res = await fetch("/api/speech/stt", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audioBase64 }),
          });
          setInterim("");
          if (!res.ok) {
            setListenError("unavailable");
            handlers.onError?.("unavailable");
            return;
          }
          const data = (await res.json()) as { text?: string };
          const text = (data.text ?? "").trim();
          if (text) {
            handlers.onHeard(text);
          } else {
            setListenError("no-speech");
            handlers.onError?.("no-speech");
          }
        } catch {
          setInterim("");
          setListenError("unavailable");
          handlers.onError?.("unavailable");
        }
      };

      stopCaptureRef.current = (shouldTranscribe: boolean) => {
        void finalize(shouldTranscribe);
      };

      processor.onaudioprocess = (event) => {
        if (finished) return;
        const input = event.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(input));
        let sumSq = 0;
        for (let i = 0; i < input.length; i++) sumSq += input[i] * input[i];
        const rms = Math.sqrt(sumSq / input.length);
        setLevel(Math.min(1, rms * 10));
        const now = Date.now();
        if (rms > 0.012) {
          heardSpeech = true;
          lastSpeechAt = now;
          setInterim("hearing you…");
        }
        const elapsed = now - startedAt;
        const silence = now - lastSpeechAt;
        if ((heardSpeech && silence > 950) || elapsed > 12_000) {
          void finalize(true);
        } else if (!heardSpeech && elapsed > 7_500) {
          void finalize(false);
          setListenError("no-speech");
          handlers.onError?.("no-speech");
        }
      };

      source.connect(processor);
      processor.connect(ctx.destination);
      setListenError(null);
      setListening(true);
      setInterim("listening…");
    },
    [],
  );

  const listen = useCallback(
    (handlers: ListenHandlers) => {
      stopListening();
      speechGeneration.current += 1;
      pendingUtterances.current = 0;
      stopAudioPlayback();
      synthesis()?.cancel();
      setSpeaking(false);

      if (engineRef.current && hasMicApi()) {
        void listenWithGateway(handlers);
        return;
      }

      const Ctor = recognitionCtor();
      if (!Ctor) {
        setListenError("unavailable");
        handlers.onError?.("unavailable");
        return;
      }

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
    [listenWithGateway, stopAudioPlayback, stopListening],
  );

  const speakBrowser = useCallback((text: string, generation: number, onDone?: () => void) => {
    const synth = synthesis();
    if (!synth || !text.trim()) {
      onDone?.();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = navigator.language || "en-US";
    utterance.rate = 1.05;
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

  /** Queue text to be read aloud. `onDone` fires once playback finishes. */
  const speak = useCallback(
    (text: string, onDone?: () => void) => {
      if (!text.trim()) {
        onDone?.();
        return;
      }
      const generation = speechGeneration.current;
      if (engineRef.current) {
        setSpeaking(true);
        fetch("/api/speech/tts", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        })
          .then(async (res) => {
            if (!res.ok) throw new Error("tts_failed");
            const blob = await res.blob();
            if (generation !== speechGeneration.current) return;
            stopAudioPlayback();
            const url = URL.createObjectURL(blob);
            audioUrlRef.current = url;
            const audio = new Audio(url);
            audioRef.current = audio;
            const finish = () => {
              if (generation !== speechGeneration.current) return;
              stopAudioPlayback();
              setSpeaking(false);
              onDone?.();
            };
            audio.onended = finish;
            audio.onerror = finish;
            await audio.play();
          })
          .catch(() => {
            if (generation !== speechGeneration.current) return;
            speakBrowser(text, generation, onDone);
          });
        return;
      }
      speakBrowser(text, generation, onDone);
    },
    [speakBrowser, stopAudioPlayback],
  );

  const stopSpeaking = useCallback(() => {
    speechGeneration.current += 1;
    pendingUtterances.current = 0;
    stopAudioPlayback();
    synthesis()?.cancel();
    setSpeaking(false);
  }, [stopAudioPlayback]);

  useEffect(
    () => () => {
      stopListening();
      stopAudioPlayback();
      synthesis()?.cancel();
    },
    [stopAudioPlayback, stopListening],
  );

  return {
    engine,
    canListen,
    canSpeak,
    listening,
    speaking,
    interim,
    level,
    listenError,
    listen,
    stopListening,
    speak,
    stopSpeaking,
  };
};
