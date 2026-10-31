import { useCallback, useEffect, useRef, useState } from 'react';
import type { APIConfig } from '../types';
import { isAudioRecordingSupported, isBrowserSttSupported, resolveSttProvider, startPrivateChatRecording, startStt, type SttCallbacks, type SttSession } from '../utils/speechToText';

export type PrivateChatSpeechStatus = 'idle' | 'starting' | 'listening' | 'transcribing' | 'review';
export type PrivateChatSpeechMode = 'record' | 'transcribe';

/** A private-chat speech draft; it never posts a message without explicit confirmation. */
export function usePrivateChatSpeech(characterId: string | undefined, apiConfig: Partial<APIConfig> | null | undefined) {
  const [status, setStatus] = useState<PrivateChatSpeechStatus>('idle');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [hasAudioDraft, setHasAudioDraft] = useState(false);
  const [mode, setMode] = useState<PrivateChatSpeechMode>('transcribe');
  const sessionRef = useRef<SttSession | null>(null);
  // Audio exists only for the paid-STT path, where we share its original stream.
  // Browser and Android native STT remain honest transcript-only fallbacks.
  const audioDraftRef = useRef<{ blob: Blob; durationSec: number } | null>(null);
  const generationRef = useRef(0);
  const editedRef = useRef(false);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopPendingRef = useRef(false);

  const clearElapsedTimer = useCallback(() => {
    if (elapsedTimerRef.current !== null) clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    generationRef.current += 1;
    stopPendingRef.current = false;
    clearElapsedTimer();
    const active = sessionRef.current;
    sessionRef.current = null;
    audioDraftRef.current = null;
    setHasAudioDraft(false);
    // Cancelling must discard captured audio, not invoke paid STT via stop().
    active?.cancel();
    setStatus('idle');
    setTranscript('');
    setError('');
    setSeconds(0);
    editedRef.current = false;
  }, [clearElapsedTimer]);

  useEffect(() => {
    // A character switch must never expose the previous character's speech draft.
    cancel();
    return () => {
      generationRef.current += 1;
      clearElapsedTimer();
      sessionRef.current?.cancel();
      sessionRef.current = null;
    };
  }, [characterId, cancel, clearElapsedTimer]);

  useEffect(() => {
    // Backgrounding the page must never leave the microphone recording silently.
    const interrupt = () => {
      if (document.visibilityState === 'hidden') {
        // An Android/browser microphone permission sheet can temporarily hide the page.
        // Cancelling during "starting" would revoke the recording before permission is granted.
        if (status === 'listening' || status === 'transcribing') cancel();
      }
    };
    const onPageHide = () => {
      if (status === 'starting' || status === 'listening' || status === 'transcribing') cancel();
    };
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    document.addEventListener('visibilitychange', interrupt);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', interrupt);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [status, cancel]);

  const start = useCallback(async (nextMode: PrivateChatSpeechMode = 'transcribe') => {
    if (!characterId || status !== 'idle') return;
    const generation = ++generationRef.current;
    sessionRef.current = null;
    audioDraftRef.current = null;
    setHasAudioDraft(false);
    stopPendingRef.current = false;
    editedRef.current = false;
    setTranscript('');
    setError('');
    setSeconds(0);
    setMode(nextMode);
    // An unsupported browser cannot transcribe audio through its microphone API.
    // Tell the user to use the actual system keyboard mic instead of recording unusable audio.
    if (nextMode === 'transcribe' && resolveSttProvider(apiConfig) === 'browser' && !isBrowserSttSupported()) {
      setError('此浏览器没有可用的语音识别接口。请选「输入法语音」，用手机键盘自带的麦克风说话。');
      setStatus('review');
      return;
    }
    setStatus('starting');
    const startedAt = Date.now();
    clearElapsedTimer();
    elapsedTimerRef.current = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    let ended = false;

    try {
      // Browser WebSpeech often exposes webkitSpeechRecognition but silently hangs
      // when its remote backend is unreachable. A user selecting "录音语音"
      // needs REAL audio, so use local MediaRecorder unless a paid ASR provider
      // was explicitly selected. Keep native speech fallback on older WebViews.
      const useLocalRecording = nextMode === 'record' && resolveSttProvider(apiConfig) === 'browser' && isAudioRecordingSupported();
      const callbacks: SttCallbacks = {
        onAudioCaptured: (blob, durationSec) => {
          if (generation !== generationRef.current || blob.size === 0 || durationSec <= 0) return;
          audioDraftRef.current = { blob, durationSec };
          setHasAudioDraft(true);
        },
        onPartial: text => {
          if (generation !== generationRef.current) return;
          setStatus(previous => previous === 'transcribing' ? previous : 'listening');
          if (!editedRef.current) setTranscript(text);
        },
        onFinal: text => {
          if (generation !== generationRef.current) return;
          if (!editedRef.current) setTranscript(text);
          setStatus('review');
        },
        onTranscribing: active => {
          if (generation !== generationRef.current) return;
          if (active) { clearElapsedTimer(); setStatus('transcribing'); }
        },
        onError: message => {
          if (generation !== generationRef.current) return;
          setError(message);
        },
        onEnd: () => {
          ended = true;
          if (generation !== generationRef.current) return;
          clearElapsedTimer();
          sessionRef.current = null;
          setStatus('review');
        },
      };
      const session = useLocalRecording
        ? await startPrivateChatRecording(callbacks)
        : await startStt('zh-CN', callbacks, apiConfig);
      if (generation !== generationRef.current || ended) {
        session.cancel();
        return;
      }
      sessionRef.current = session;
      if (stopPendingRef.current) {
        stopPendingRef.current = false;
        session.stop();
      } else {
        setStatus(previous => previous === 'starting' ? 'listening' : previous);
      }
    } catch (cause) {
      if (generation !== generationRef.current) return;
      clearElapsedTimer();
      sessionRef.current = null;
      setError(cause instanceof Error ? cause.message : '语音识别失败');
      setStatus('review');
    }
  }, [characterId, status, apiConfig, clearElapsedTimer]);

  const stop = useCallback(() => {
    if (status !== 'starting' && status !== 'listening') return;
    clearElapsedTimer();
    if (sessionRef.current) sessionRef.current.stop();
    else stopPendingRef.current = true;
    // Browser/native final callbacks may still arrive; never auto-send.
    setStatus('transcribing');
  }, [status, clearElapsedTimer]);

  const startTranscription = useCallback(() => start('transcribe'), [start]);
  const startRecording = useCallback(() => start('record'), [start]);

  const editTranscript = useCallback((text: string) => {
    editedRef.current = true;
    setTranscript(text);
  }, []);

  const getAudioDraft = useCallback(() => audioDraftRef.current, []);

  return { status, mode, transcript, error, seconds, hasAudioDraft, start: startRecording, startTranscription, stop, cancel, editTranscript, getAudioDraft };
}
