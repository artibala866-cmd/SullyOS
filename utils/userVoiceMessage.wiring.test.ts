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

  it('uses a compact, embedded microphone without shrinking the private-chat composer', () => {
    const input = read('components/chat/ChatInputArea.tsx');
    const composer = input.slice(
      input.indexOf('sully-chat-composer px-2.5 py-2.5'),
      input.indexOf('{emojiSelectionMode && (', input.indexOf('sully-chat-composer px-2.5 py-2.5')),
    );
    // Exactly three outer columns: add, expandable input with emoji/mic, send.
    expect(composer).toContain('sully-chat-input-wrap flex-1 min-w-0');
    expect(composer).toContain('sully-chat-voice-trigger w-9 h-9');
    expect(composer).toContain('sully-chat-voice-menu absolute bottom-full');
    expect(composer).toContain('flex w-full items-center gap-2.5 rounded-xl'); // stacked items, not two large squares
    expect(composer).toContain('录音语音');
    expect(composer).toContain('文字模拟语音');
    expect(composer).toContain('恢复普通文字');
    expect(composer).not.toContain('w-11 h-10 rounded-xl grid place-items-center');
    const mic = composer.indexOf('sully-chat-voice-trigger');
    const inputWrapEnd = composer.indexOf('</div>', mic);
    expect(mic).toBeGreaterThan(0);
    expect(inputWrapEnd).toBeGreaterThan(mic); // mic renders in the input wrap
    expect(input).toContain("if (showPanel !== 'none') setShowPanel('none')");
    expect(input).toContain('voiceMenuRef.current?.contains(target)');
  });

  it('keeps Char TTS distinct and never shows fake audio playback', () => {
    const item = read('components/chat/MessageItem.tsx');
    const bubble = read('components/chat/UserVoiceBubble.tsx');
    expect(item).toContain("if (isUser && m.type === 'voice')");
    expect(item).toContain("!isUser && m.type === 'text'");
    // Screenshot regression: user voice must borrow the original light bar,
    // never the extra black user text-bubble surface.
    const userBranch = item.slice(item.indexOf("if (isUser && m.type === 'voice')"), item.indexOf('// --- Inline formatting parser'));
    expect(userBranch).not.toContain('sully-bubble-user');
    expect(userBranch).not.toContain('style={containerStyle}');
    expect(userBranch).toContain('styleConfig={activeTheme.ai}');
    expect(bubble).toContain('sully-voice-bar-shell sully-user-voice-message');
    expect(bubble).toContain('sully-voice-bar flex items-center gap-2.5 w-full px-3 py-2 rounded-2xl');
    expect(bubble).toContain('sully-voice-bar-button');
    expect(bubble).toContain('sully-voice-bar-wave-segment');
    expect(bubble).toContain('sully-voice-bar-toggle');
    expect(bubble).toContain("showVoiceText ? '收起' : '转文字'");
    expect(bubble).toContain('仅转写，无可播放录音');
    expect(bubble).toContain('{voice.transcript ||');
  });

  it('stores paid-provider WAV without a second microphone capture, and cleans up safely', () => {
    const stt = read('utils/speechToText.ts');
    const hook = read('hooks/usePrivateChatSpeech.ts');
    const chat = read('apps/Chat.tsx');
    expect(stt).toContain('cb.onAudioCaptured?.(wavBlob, totalSamples / sampleRate)');
    expect(hook).toContain('audioDraftRef.current = { blob, durationSec }');
    expect(hook).toContain("document.addEventListener('visibilitychange', interrupt)");
    expect(chat).toContain('const recorded = privateChatSpeech.getAudioDraft()');
    expect(chat).toContain('audioRef = await putImageBlob(recorded.blob)');
    expect(chat).toContain('metadata = attachUserVoiceAudio(metadata, audioRef, recorded.durationSec)');
    expect(chat).toContain('cleanupDeletedUserVoiceAudio');
    expect(chat).toContain('editedVoiceMetadata');
    expect(chat).toContain('deleteBlobRefIfUnreferenced');
  });

  it('passes both user voice variants to the model history via canonical normalization', () => {
    const prompts = read('utils/chatPrompts.ts');
    const normalizer = read('utils/messageFormat.ts');
    expect(prompts).toContain("else if (m.type === 'voice')");
    expect(normalizer).toContain("msg.metadata?.inputMode === 'typed'");
    expect(normalizer).toContain('[用户发送语音消息，转写内容]');
  });
});
