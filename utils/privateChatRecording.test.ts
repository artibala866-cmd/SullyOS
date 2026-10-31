import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startPrivateChatRecording } from './speechToText';
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
