import { afterEach, describe, expect, it, vi } from 'vitest';
import { startPrivateChatStt, startStt } from './speechToText';
import { makeUserVoiceMetadata } from './userVoiceMessage';
import { getVoiceTranscript, normalizeMessageContent } from './messageFormat';
import type { Message } from '../types';

describe('existing user voice history', () => {
  it('keeps historical audio-only metadata honest, without inventing transcripts', () => {
    const meta = makeUserVoiceMetadata('', 'recorded');
    expect(meta).toMatchObject({ transcript: '', inputMode: 'recorded', hasAudio: false });
    expect(() => makeUserVoiceMetadata('', 'typed')).toThrow();
    const msg = { id: 1, charId: 'a', type: 'voice', role: 'user', content: '[语音]', timestamp: 0, metadata: meta } as Message;
    expect(getVoiceTranscript(msg)).toBe('');
    expect(normalizeMessageContent(msg, 'Char', '用户')).toBe('[语音]');
    msg.metadata = makeUserVoiceMetadata('我今晚有空', 'recorded');
    expect(getVoiceTranscript(msg)).toBe('我今晚有空');
  });
});

describe('real speech-to-text route instead of decorative recording', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('passes recognized Chinese words to the final transcript without inventing audio', async () => {
    class BrowserRecognizer {
      static current: BrowserRecognizer | null = null;
      lang = '';
      continuous = false;
      interimResults = false;
      onaudiostart: (() => void) | null = null;
      onspeechstart: (() => void) | null = null;
      onresult: ((event: any) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: any) => void) | null = null;
      constructor() { BrowserRecognizer.current = this; }
      start() { this.onaudiostart?.(); }
      stop() { this.onend?.(); }
      abort() {}
    }
    vi.stubGlobal('window', {
      SpeechRecognition: BrowserRecognizer,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    const partial = vi.fn(), final = vi.fn(), end = vi.fn(), audio = vi.fn();
    const session = await startStt('zh-CN', {
      onPartial: partial,
      onFinal: final,
      onAudioCaptured: audio,
      onEnd: end,
    }, { sttProvider: 'browser' });
    expect(BrowserRecognizer.current?.lang).toBe('zh-CN');
    const recognized = Object.assign([{ transcript: '你好，今天有空吗？' }], { isFinal: true });
    BrowserRecognizer.current?.onresult?.({ resultIndex: 0, results: [recognized] });
    expect(partial).toHaveBeenCalledWith('你好，今天有空吗？');
    session.stop();
    expect(final).toHaveBeenCalledWith('你好，今天有空吗？');
    expect(end).toHaveBeenCalledTimes(1);
    expect(audio).not.toHaveBeenCalled(); // browser recognizer provides text, not a recorded audio file
  });
});

describe('browser speech recognition resilience', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  const makeRecognizer = (signal: 'audio' | 'none' | 'result') => {
    class Recognizer {
      static current: Recognizer;
      onresult: ((event: any) => void) | null = null;
      onend: (() => void) | null = null;
      onaudiostart: (() => void) | null = null;
      onspeechstart: (() => void) | null = null;
      onerror: ((event: any) => void) | null = null;
      lang = '';
      continuous = false;
      interimResults = false;
      stopCount = 0;
      constructor() { Recognizer.current = this; }
      start() {
        if (signal === 'audio') this.onaudiostart?.();
        if (signal === 'result') {
          this.onresult?.({ resultIndex: 0, results: [
            Object.assign([{ transcript: '真实识别的内容' }], { isFinal: true }),
          ] });
        }
      }
      stop() { this.stopCount++; this.onend?.(); }
      abort() { this.onend?.(); }
    }
    vi.stubGlobal('window', {
      SpeechRecognition: Recognizer,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    return Recognizer;
  };

  it('stops an Android browser that starts the mic but never returns any words', async () => {
    vi.useFakeTimers();
    const Recognizer = makeRecognizer('audio');
    const onError = vi.fn(), onEnd = vi.fn(), onFinal = vi.fn();
    const session = await startStt('zh-CN', { onError, onEnd, onFinal }, { sttProvider: 'browser' });
    await vi.advanceTimersByTimeAsync(15_050);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0][0])).toContain('没有返回文字');
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onFinal).not.toHaveBeenCalled();
    expect(Recognizer.current.stopCount).toBe(1);
    session.cancel();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('ends a recognizer with no microphone start event instead of spinning forever', async () => {
    vi.useFakeTimers();
    const Recognizer = makeRecognizer('none');
    const onError = vi.fn(), onEnd = vi.fn();
    const session = await startStt('zh-CN', { onError, onEnd }, { sttProvider: 'browser' });
    await vi.advanceTimersByTimeAsync(7_100);
    expect(String(onError.mock.calls[0][0])).toContain('没有响应');
    expect(Recognizer.current.stopCount).toBe(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    session.stop();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('preserves genuine recognized text and does not trigger a false timeout', async () => {
    vi.useFakeTimers();
    const Recognizer = makeRecognizer('result');
    const onError = vi.fn(), onFinal = vi.fn(), onEnd = vi.fn();
    const session = await startStt('zh-CN', { onError, onFinal, onEnd }, { sttProvider: 'browser' });
    await vi.advanceTimersByTimeAsync(16_000);
    expect(onError).not.toHaveBeenCalled();
    session.stop();
    expect(Recognizer.current.stopCount).toBe(1);
    expect(onFinal).toHaveBeenCalledWith('真实识别的内容');
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

describe('private-chat speech-to-text needs only one microphone', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  const setupBrowserRecognizer = () => {
    class Recognizer {
      static current: Recognizer;
      onresult: ((event: any) => void) | null = null;
      onend: (() => void) | null = null;
      onaudiostart: (() => void) | null = null;
      onspeechstart: (() => void) | null = null;
      onerror: ((event: any) => void) | null = null;
      continuous = false;
      interimResults = false;
      lang = '';
      stopCount = 0;
      abortCount = 0;
      constructor() { Recognizer.current = this; }
      start() { this.onaudiostart?.(); }
      stop() { this.stopCount++; this.onend?.(); }
      abort() { this.abortCount++; this.onend?.(); }
    }
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('SpeechRecognition', Recognizer);
    return Recognizer;
  };

  it('transcribes genuine Chinese words without opening a second recording stream', async () => {
    const Recognizer = setupBrowserRecognizer();
    const getUserMedia = vi.fn(async () => { throw Error('Second microphone must not open'); });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const calls: string[] = [];
    const onFinal = vi.fn((text: string) => calls.push('text:' + text));
    const onAudioCaptured = vi.fn();
    const onEnd = vi.fn(() => calls.push('end'));
    const session = await startPrivateChatStt('zh-CN', { onFinal, onAudioCaptured, onEnd }, { sttProvider: 'browser' });
    expect(getUserMedia).not.toHaveBeenCalled();
    const word = Object.assign([{ transcript: '今天要画画' }], { isFinal: true });
    Recognizer.current.onresult?.({ resultIndex: 0, results: [word] });
    session.stop();
    expect(onFinal).toHaveBeenCalledWith('今天要画画');
    expect(onAudioCaptured).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(calls.at(-1)).toBe('end');
    expect(Recognizer.current.stopCount).toBe(1);
  });

  it('cancels recognition immediately without opening or saving audio', async () => {
    const Recognizer = setupBrowserRecognizer();
    const getUserMedia = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const audio = vi.fn(), end = vi.fn(), final = vi.fn();
    const session = await startPrivateChatStt('zh-CN', {
      onAudioCaptured: audio, onEnd: end, onFinal: final,
    }, { sttProvider: 'browser' });
    session.cancel();
    expect(Recognizer.current.abortCount).toBe(1);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(audio).not.toHaveBeenCalled();
    expect(final).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('does not block browser recognition on a separate microphone permission denial', async () => {
    const Recognizer = setupBrowserRecognizer();
    const getUserMedia = vi.fn(async () => {
      throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const onFinal = vi.fn(), onEnd = vi.fn(), onError = vi.fn();
    const session = await startPrivateChatStt('zh-CN', { onFinal, onEnd, onError }, { sttProvider: 'browser' });
    expect(getUserMedia).not.toHaveBeenCalled();
    Recognizer.current.onresult?.({ resultIndex: 0, results: [
      Object.assign([{ transcript: '说出的内容' }], { isFinal: true }),
    ] });
    session.stop();
    expect(onFinal).toHaveBeenCalledWith('说出的内容');
    expect(onError).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
