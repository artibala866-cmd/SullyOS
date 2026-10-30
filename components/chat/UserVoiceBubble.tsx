import React, { useEffect, useRef, useState } from 'react';
import { CaretDown, CaretUp, FileText, Pause, Play, Waveform } from '@phosphor-icons/react';
import type { BubbleStyle, Message } from '../../types';
import { useBlobRefUrl } from '../../utils/blobRef';
import { describeUserVoice } from '../../utils/userVoiceMessage';

interface Props {
  message: Message;
  styleConfig: BubbleStyle;
  initiallyExpanded?: boolean;
}

/**
 * User-side voice only; Char TTS bars are a separate code path.
 * No audio -> no Play control and no made-up recording duration.
 */
const UserVoiceBubble: React.FC<Props> = ({ message, styleConfig, initiallyExpanded = false }) => {
  const voice = describeUserVoice(message);
  const audioUrl = useBlobRefUrl(voice.audioRef);
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const textColor = styleConfig.voiceBarTextColor || styleConfig.textColor;
  const barBackground = styleConfig.voiceBarBg || 'rgba(127,127,127,0.11)';
  const waveformColor = styleConfig.voiceBarWaveColor || textColor;

  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (audio) { audio.pause(); audio.src = ''; }
      audioRef.current = null;
    };
  }, [audioUrl]);

  const togglePlayback = () => {
    if (!audioUrl) return;
    const active = audioRef.current;
    if (active && !active.paused) {
      active.pause();
      setPlaying(false);
      return;
    }
    const audio = active || new Audio(audioUrl);
    if (!active) {
      audio.onended = () => setPlaying(false);
      audio.onerror = () => setPlaying(false);
      audioRef.current = audio;
    }
    void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };

  const toggleTranscript = () => setExpanded(current => !current);
  const duration = voice.durationSec === undefined ? null
    : `${String(Math.floor(voice.durationSec / 60)).padStart(2, '0')}:${String(voice.durationSec % 60).padStart(2, '0')}`;

  return (
    <div className="sully-user-voice-message relative z-10 w-full max-w-[265px] min-w-[148px]" style={{ color: textColor }}>
      <div className="sully-user-voice-bar flex items-center gap-2.5 rounded-xl px-2 py-1.5" style={{ background: barBackground }}>
        {audioUrl && (
          <button type="button" onClick={event => { event.stopPropagation(); togglePlayback(); }}
            aria-label={playing ? '暂停录音' : '播放录音'} title={playing ? '暂停' : '播放'}
            className="shrink-0 w-8 h-8 rounded-full grid place-items-center hover:bg-black/10">
            {playing ? <Pause size={19} weight="fill" /> : <Play size={19} weight="fill" />}
          </button>
        )}
        <button type="button" aria-label={expanded ? '收起语音文字' : '展开语音文字'}
          title={expanded ? '收起转写' : '查看转写'} aria-expanded={expanded}
          onClick={toggleTranscript}
          className="flex-1 min-w-0 min-h-9 flex items-center gap-2 active:opacity-75">
          <Waveform size={21} weight="regular" aria-hidden="true" style={{ color: waveformColor }} />
          <span className="flex-1 flex gap-[3px] items-center justify-start overflow-hidden h-5" aria-hidden="true">
            {[4, 10, 6, 14, 8, 12, 5, 11, 7, 13, 4, 9].map((height, index) => (
              <span key={index} className="w-[2px] rounded-full shrink-0" style={{ height: `${height}px`, backgroundColor: waveformColor, opacity: 0.5 + (index % 3) * 0.12 }} />
            ))}
          </span>
          {duration && <span className="font-mono text-[11px] tabular-nums opacity-70">{duration}</span>}
          <FileText size={16} className="shrink-0 opacity-70" aria-hidden="true" />
          {expanded ? <CaretUp size={14} className="shrink-0 opacity-70" /> : <CaretDown size={14} className="shrink-0 opacity-70" />}
        </button>
      </div>
      {expanded && (
        <div className="sully-user-voice-transcript mt-2 px-1 text-[13px] leading-relaxed whitespace-pre-wrap break-words select-text"
          aria-label="语音消息文字">
          {voice.transcript || '（无转写内容）'}
        </div>
      )}
    </div>
  );
};

export default React.memo(UserVoiceBubble);
