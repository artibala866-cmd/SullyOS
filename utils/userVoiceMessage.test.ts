import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import { makeUserVoiceMetadata, describeUserVoice } from './userVoiceMessage';
import { normalizeMessageContent, getVoiceTranscript } from './messageFormat';

const message = (text: string, metadata: any): Message => ({
  id: 42,
  charId: 'char-1',
  role: 'user',
  type: 'voice',
  content: text,
  timestamp: 1,
  metadata,
});

describe('private user voice messages', () => {
  it('preserves typed voice as a text-only voice message', () => {
    const metadata = makeUserVoiceMetadata('  今天画完稿啦  ', 'typed');
    const msg = message('今天画完稿啦', metadata);
    expect(metadata).toEqual({
      transcript: '今天画完稿啦',
      inputMode: 'typed',
      hasAudio: false,
    });
    expect(describeUserVoice(msg)).toEqual({ transcript: '今天画完稿啦', mode: 'typed', audioRef: undefined, durationSec: undefined });
    expect(normalizeMessageContent(msg, 'Char', '用户')).toContain('今天画完稿啦');
    expect(normalizeMessageContent(msg, 'Char', '用户')).toContain('语音消息形式');
  });

  it('marks real STT as transcript-only without inventing audio or duration', () => {
    const msg = message('你好', makeUserVoiceMetadata('你好', 'recorded'));
    expect(describeUserVoice(msg)).toEqual({ transcript: '你好', mode: 'recorded', audioRef: undefined, durationSec: undefined });
    expect(normalizeMessageContent(msg, 'Char', '用户')).toContain('语音消息，转写内容');
  });

  it('never offers a fake player for blob URL, data URI or text-only metadata', () => {
    for (const audioRef of ['blob:expired', 'data:audio/wav;base64,aaaa', 'https://example.com/sound.mp3', undefined]) {
      const msg = message('原文', { transcript: '原文', inputMode: 'typed', hasAudio: true, audioRef, durationSec: 88 });
      expect(describeUserVoice(msg).audioRef).toBeUndefined();
      expect(describeUserVoice(msg).durationSec).toBeUndefined();
    }
  });

  it('rejects blank messages and protects against audio URI leaking into context', () => {
    expect(() => makeUserVoiceMetadata('  ', 'typed')).toThrow();
    expect(getVoiceTranscript(message('blob:expired', {}))).toBe('');
  });

  it('keeps legacy voice transcripts readable', () => {
    const legacy = message(' ', { originalText: '以前的语音' });
    expect(describeUserVoice(legacy).transcript).toBe('以前的语音');
  });
});
