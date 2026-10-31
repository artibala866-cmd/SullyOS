import type { Message } from '../types';
import { isBlobRef } from './blobRef';
import { getVoiceTranscript } from './messageFormat';

export type UserVoiceInputMode = 'typed' | 'recorded';

export type UserVoiceMetadata = {
  transcript: string;
  inputMode: UserVoiceInputMode;
  hasAudio: boolean;
  audioRef?: string;
  durationSec?: number;
};

/** Preserve genuine voice/typed origin; never invent recorded audio or duration. */
export function makeUserVoiceMetadata(text: string, inputMode: UserVoiceInputMode): UserVoiceMetadata {
  const transcript = text.trim();
  // Real audio can be sent without invented recognition text.
  // A typed simulation must always include actual user-authored words.
  if (!transcript && inputMode === 'typed') throw new Error('语音消息不能是空白内容');
  return { transcript, inputMode, hasAudio: false };
}

/** Never mark a voice message as playable before its real audio bytes are stored. */
export function attachUserVoiceAudio(
  metadata: UserVoiceMetadata,
  audioRef: string,
  durationSec: number,
): UserVoiceMetadata {
  if (metadata.inputMode !== 'recorded' || !isBlobRef(audioRef)
      || !Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error('无效的真实录音资源');
  }
  return { ...metadata, hasAudio: true, audioRef, durationSec: Math.max(1, Math.ceil(durationSec)) };
}

/** Correct the words, not the immutable original recording. */
export function reviseUserVoiceTranscript(metadata: Message['metadata'], correctedText: string) {
  return { ...metadata, transcript: correctedText.trim() };
}

/** A forwarded record is a text snapshot, not a second audio attachment. */
export function formatForwardedUserVoice(message: Message): string {
  const text = getVoiceTranscript(message);
  return text ? `[语音记录] ${text}` : '[语音记录] 仅有原声，未转发音频文件';
}

/**
 * Voice messages forwarded within the same local-first database can keep the
 * original BlobRef. The forward card is then a genuine playable snapshot and
 * v3 backup/GC can see that shared reference in its serialized message content.
 */
export function forwardUserVoiceSnapshot(message: Message) {
  const voice = describeUserVoice(message);
  return {
    role: message.role,
    type: 'voice' as const,
    content: voice.transcript || '[语音]',
    timestamp: message.timestamp,
    metadata: {
      inputMode: voice.mode,
      transcript: voice.transcript,
      hasAudio: !!voice.audioRef,
      ...(voice.audioRef ? { audioRef: voice.audioRef } : {}),
      ...(voice.durationSec ? { durationSec: voice.durationSec } : {}),
    },
  };
}

/** Only saved, referenced audio qualifies for a playable voice bar. */
export function describeUserVoice(msg: Message): {
  transcript: string;
  mode: UserVoiceInputMode;
  audioRef?: string;
  durationSec?: number;
} {
  const metadata = msg.metadata || {};
  const mode: UserVoiceInputMode = metadata.inputMode === 'typed' ? 'typed' : 'recorded';
  const audioRef = metadata.hasAudio === true && typeof metadata.audioRef === 'string'
    && isBlobRef(metadata.audioRef) ? metadata.audioRef : undefined;
  const durationSec = audioRef && Number.isFinite(metadata.durationSec) && metadata.durationSec > 0
    ? Math.round(metadata.durationSec) : undefined;
  return { transcript: getVoiceTranscript(msg), mode, audioRef, durationSec };
}
