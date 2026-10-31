import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startPrivateChatRecording, startPrivateChatStt, startStt } from './speechToText';
import { makeUserVoiceMetadata } from './userVoiceMessage';
import { getVoiceTranscript, normalizeMessageContent } from './messageFormat';
import type { Message } from '../types';

const trackStop = vi.fn();
class FakeRecorder {
  static isTypeSupported = (type: string) => type.includes('webm');
  state = 'inactive';
  mimeType = 'audio/webm;codecs=opus';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onerror: (() => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: unknown) {}
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['voice-binary'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

describe('private chat real microphone recording', () => {
  beforeEach(() => {
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn(async () => ({
        getTracks: () => [{ stop: trackStop }],
      })) },
    });
    trackStop.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('captures playable real audio even when no browser speech recognition service exists', async () => {
    const audio = vi.fn();
    const end = vi.fn();
    const error = vi.fn();
    const session = await startPrivateChatRecording({ onAudioCaptured: audio, onEnd: end, onError: error });
    // No SpeechRecognition constructor and no paid STT provider configured.
    await new Promise(resolve => setTimeout(resolve, 230));
    session.stop();
    expect(error).not.toHaveBeenCalled();
    expect(audio).toHaveBeenCalledTimes(1);
    expect(audio.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(audio.mock.calls[0][0].type).toBe('audio/webm;codecs=opus');
    expect(audio.mock.calls[0][0].size).toBeGreaterThan(0);
    expect(audio.mock.calls[0][1]).toBeGreaterThan(0);
    expect(end).toHaveBeenCalledTimes(1);
    expect(trackStop).toHaveBeenCalled();
    session.stop();
    expect(audio).toHaveBeenCalledTimes(1);
  });

  it('cancels recording without emitting an audio asset', async () => {
    const audio = vi.fn(), end = vi.fn();
    const session = await startPrivateChatRecording({ onAudioCaptured: audio, onEnd: end });
    session.cancel();
    expect(audio).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledTimes(1);
    expect(trackStop).toHaveBeenCalled();
  });

  it('reports denied microphone permission instead of creating an empty fake voice', async () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => {
      throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    }) } });
    const error = vi.fn(), end = vi.fn(), audio = vi.fn();
    const session = await startPrivateChatRecording({ onError: error, onEnd: end, onAudioCaptured: audio });
    expect(error.mock.calls[0][0]).toContain('麦克风权限被拒绝');
    expect(audio).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledTimes(1);
    session.cancel();
  });

  it('keeps audio-only speech honest, and lets the user supply a real transcript', () => {
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

describe('combined private-chat audio and words', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('saves the real recording and recognized text before a single onEnd', async () => {
    class Recognizer {
      static current: Recognizer;
      onresult: ((event: any) => void) | null = null;
      onend: (() => void) | null = null;
      onaudiostart: (() => void) | null = null;
      onerror: ((event: any) => void) | null = null;
      continuous = false; interimResults = false; lang = '';
      constructor() { Recognizer.current = this; }
      start() { this.onaudiostart?.(); }
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
    }
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('SpeechRecognition', Recognizer);
    vi.stubGlobal('SpeechRecognition', Recognizer);
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    const stopTrack = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => ({
      getTracks: () => [{ stop: stopTrack }],
    })) } });
    const calls: string[] = [];
    const end = vi.fn(() => calls.push('end'));
    const final = vi.fn((words: string) => calls.push('words:'+words));
    const audio = vi.fn((blob: Blob) => calls.push('audio:'+blob.type));
    const session = await startPrivateChatStt('zh-CN', {
      onEnd: end, onFinal: final, onAudioCaptured: audio,
    }, { sttProvider: 'browser' });
    await new Promise(resolve => setTimeout(resolve, 220));
    const spoken = Object.assign([{ transcript: '今天要画画' }], { isFinal: true });
    Recognizer.current.onresult?.({ resultIndex: 0, results: [spoken] });
    session.stop();
    expect(final).toHaveBeenCalledWith('今天要画画');
    expect(audio).toHaveBeenCalledTimes(1);
    expect(audio.mock.calls[0][0].type).toContain('audio/webm');
    expect(end).toHaveBeenCalledTimes(1);
    expect(calls.at(-1)).toBe('end');
    expect(stopTrack).toHaveBeenCalled();
  });

  it('discards both captured audio and STT when the user cancels', async () => {
    class Recognizer {
      onend: (() => void) | null = null;
      onaudiostart: (() => void) | null = null;
      onerror: ((event: any) => void) | null = null;
      start() { this.onaudiostart?.(); }
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
    }
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('SpeechRecognition', Recognizer);
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    const stopTrack = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => ({
      getTracks: () => [{ stop: stopTrack }],
    })) } });
    const audio = vi.fn(), end = vi.fn(), final = vi.fn();
    const session = await startPrivateChatStt('zh-CN', {
      onAudioCaptured: audio, onEnd: end, onFinal: final,
    }, { sttProvider: 'browser' });
    session.cancel();
    expect(audio).not.toHaveBeenCalled();
    expect(final).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
    expect(stopTrack).toHaveBeenCalled();
  });

  it('continues genuine transcription when microphone audio storage is not permitted', async () => {
    class Recognizer {
      static current: Recognizer;
      onresult: ((event: any) => void) | null = null;
      onend: (() => void) | null = null;
      onaudiostart: (() => void) | null = null;
      onerror: ((event: any) => void) | null = null;
      constructor() { Recognizer.current = this; }
      start() { this.onaudiostart?.(); }
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
    }
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('SpeechRecognition', Recognizer);
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => {
      throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    }) } });
    const audio = vi.fn(), end = vi.fn(), final = vi.fn(), error = vi.fn();
    const session = await startPrivateChatStt('zh-CN', { onAudioCaptured: audio, onEnd: end, onFinal: final, onError: error }, { sttProvider: 'browser' });
    expect(error).toHaveBeenCalledTimes(1);
    expect(audio).not.toHaveBeenCalled();
    Recognizer.current.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript:'说出的内容' }], { isFinal: true })] });
    session.stop();
    expect(final).toHaveBeenCalledWith('说出的内容');
    expect(end).toHaveBeenCalledTimes(1);
  });
});
