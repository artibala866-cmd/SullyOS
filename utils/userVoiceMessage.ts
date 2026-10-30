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
  if (!transcript) throw new Error('语音消息不能是空白内容');
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
