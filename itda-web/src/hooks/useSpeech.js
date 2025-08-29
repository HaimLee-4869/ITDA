// src/hooks/useSpeech.js
import { useEffect, useRef, useState } from "react";

/**
 * 간단 Web Speech API 훅 (STT + TTS)
 * - start(): 음성 인식 시작
 * - stop(): 음성 인식 중지
 * - speak(text): 텍스트 읽기(TTS)
 * - onResult(fn): 인식 결과 콜백 등록
 */
export default function useSpeech({ lang = "ko-KR" } = {}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");

  const recognitionRef = useRef(null);
  const onResultRef = useRef(null);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setSupported(false);
      return;
    }
    setSupported(true);

    const rec = new SR();
    rec.lang = lang;
    rec.interimResults = false;
    rec.continuous = false;

    rec.onstart = () => {
      setListening(true);
      setError("");
      setTranscript("");
    };
    rec.onend = () => setListening(false);
    rec.onerror = (e) => {
      setError(e.error || "speech error");
      setListening(false);
    };
    rec.onresult = (e) => {
      const text = Array.from(e.results).map((r) => r[0].transcript).join(" ");
      setTranscript(text);
      if (onResultRef.current) onResultRef.current(text);
    };

    recognitionRef.current = rec;
    return () => {
      try {
        rec.abort();
      } catch {}
    };
  }, [lang]);

  const start = () => {
    if (!supported || !recognitionRef.current) return false;
    setError("");
    setTranscript("");
    recognitionRef.current.start();
    return true;
  };

  const stop = () => {
    try {
      recognitionRef.current && recognitionRef.current.stop();
    } catch {}
  };

  const speak = (text) => {
    if (!("speechSynthesis" in window)) return false;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    // iOS/사파리에서 처음 한 번 공백 읽기를 해줘야 깨어나는 경우가 있어 옵션
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    return true;
  };

  const onResult = (fn) => {
    onResultRef.current = fn;
  };

  return { supported, listening, transcript, error, start, stop, speak, onResult };
}
