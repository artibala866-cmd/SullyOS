import { useCallback, useEffect, useRef, useState } from 'react';
import type { APIConfig } from '../types';
import { startStt, type SttSession } from '../utils/speechToText';

export type PrivateChatSpeechStatus = 'idle' | 'starting' | 'listening' | 'transcribing' | 'review';

/** A private-chat speech draft; it never posts a message without explicit confirmation. */
export function usePrivateChatSpeech(characterId: string | undefined, apiConfig: Partial<APIConfig> | null | undefined) {
  const [status, setStatus] = useState<PrivateChatSpeechStatus>('idle');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const sessionRef = useRef<SttSession | null>(null);
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

  const start = useCallback(async () => {
    if (!characterId || status !== 'idle') return;
    const generation = ++generationRef.current;
    sessionRef.current = null;
    stopPendingRef.current = false;
    editedRef.current = false;
    setTranscript('');
    setError('');
    setSeconds(0);
    setStatus('starting');
    const startedAt = Date.now();
    clearElapsedTimer();
    elapsedTimerRef.current = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 250);
    let ended = false;

    try {
      const session = await startStt('zh-CN', {
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
      }, apiConfig);
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

  const editTranscript = useCallback((text: string) => {
    editedRef.current = true;
    setTranscript(text);
  }, []);

  return { status, transcript, error, seconds, start, stop, cancel, editTranscript };
}
