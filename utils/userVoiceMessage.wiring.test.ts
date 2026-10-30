import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relative: string) =>
  readFileSync(new URL('../' + relative, import.meta.url), 'utf8');

describe('user voice must use the actual private-chat pipeline', () => {
  it('sends both real STT and typed voice as voice, not as ordinary text', () => {
    const chat = read('apps/Chat.tsx');
    expect(chat).toContain("makeUserVoiceMetadata(text, 'recorded')");
    expect(chat).toContain("makeUserVoiceMetadata(text, 'typed')");
    expect(chat).toContain("handleSendText(undefined, 'voice'");
    expect(chat).toContain("handleSendText(text, 'voice'");
    expect(chat).toContain("'emoji', 'voice'");
    expect(chat).toContain("speechInput={{ ...privateChatSpeech, confirm: handleConfirmSpeechTranscript }}");
  });

  it('keeps the keyboard mode on the original composer and marks its send action', () => {
    const input = read('components/chat/ChatInputArea.tsx');
    expect(input).toContain('onClick={typedVoiceEnabled ? onSendTypedVoice');
    expect(input).toContain("if (typedVoiceEnabled) onSendTypedVoice?.()");
    expect(input).toContain('aria-label={typedVoiceEnabled ? \'发送文字语音\'');
    expect(input).toContain('aria-pressed={typedVoiceEnabled}');
  });

  it('keeps Char TTS distinct and never shows fake audio playback', () => {
    const item = read('components/chat/MessageItem.tsx');
    const bubble = read('components/chat/UserVoiceBubble.tsx');
    expect(item).toContain("if (isUser && m.type === 'voice')");
    expect(item).toContain("!isUser && m.type === 'text'");
    expect(bubble).toContain('{audioUrl && (');
    expect(bubble).toContain('{duration && <span');
    expect(bubble).toContain('{voice.transcript ||');
  });

  it('passes both user voice variants to the model history via canonical normalization', () => {
    const prompts = read('utils/chatPrompts.ts');
    const normalizer = read('utils/messageFormat.ts');
    expect(prompts).toContain("else if (m.type === 'voice')");
    expect(normalizer).toContain("msg.metadata?.inputMode === 'typed'");
    expect(normalizer).toContain('[用户发送语音消息，转写内容]');
  });
});
