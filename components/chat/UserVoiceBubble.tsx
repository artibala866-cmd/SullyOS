import React, { useEffect, useRef, useState } from 'react';
import { Pause, Play, Waveform } from '@phosphor-icons/react';
import type { BubbleStyle, Message } from '../../types';
import { useBlobRefUrl } from '../../utils/blobRef';
import { describeUserVoice } from '../../utils/userVoiceMessage';

interface Props {
  message: Message;
  /** Pass the original Char voice palette so the two directions look identical. */
  styleConfig: BubbleStyle;
  initiallyExpanded?: boolean;
}

// Exact same waveform heights as the original voice bar in MessageItem.tsx.
const WAVE_HEIGHTS = [4, 10, 6, 14, 8, 12, 5, 11, 7, 13, 4, 9, 6, 11, 5, 8, 10, 7, 12, 6];

const UserVoiceBubble: React.FC<Props> = ({ message, styleConfig, initiallyExpanded = false }) => {
  const voice = describeUserVoice(message);
  const audioUrl = useBlobRefUrl(voice.audioRef);
  const [showVoiceText, setShowVoiceText] = useState(initiallyExpanded);
  const [isVoicePlaying, setIsVoicePlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const vbBg = styleConfig.voiceBarBg;
  const vbActiveBg = styleConfig.voiceBarActiveBg;
  const vbBtn = styleConfig.voiceBarBtnColor;
  const vbWave = styleConfig.voiceBarWaveColor;
  const vbText = styleConfig.voiceBarTextColor;

  useEffect(() => {
    setIsVoicePlaying(false);
    return () => {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.src = '';
      }
      audioRef.current = null;
    };
  }, [audioUrl]);

  const togglePlayback = () => {
    if (!audioUrl) return;
    const active = audioRef.current;
    if (active && !active.paused) {
      active.pause();
      setIsVoicePlaying(false);
      return;
    }
    const audio = active || new Audio(audioUrl);
    if (!active) {
      audio.onended = () => setIsVoicePlaying(false);
      audio.onerror = () => setIsVoicePlaying(false);
      audioRef.current = audio;
    }
    void audio.play().then(() => setIsVoicePlaying(true)).catch(() => setIsVoicePlaying(false));
  };

  const waveform = (
    <div className="sully-voice-bar-wave flex-1 flex items-center gap-[3px] h-5 overflow-hidden" aria-hidden="true">
      {WAVE_HEIGHTS.map((h, i) => (
        <div key={i}
          className={`sully-voice-bar-wave-segment w-[2.5px] rounded-full transition-all duration-150 ${isVoicePlaying ? 'animate-pulse' : ''}`}
          style={{
            height: isVoicePlaying ? `${Math.max(3, h + Math.sin(i * 0.8) * 3)}px` : `${Math.max(2, h * 0.4)}px`,
            backgroundColor: isVoicePlaying
              ? (vbWave || `rgba(16, 185, 129, ${0.4 + (h / 14) * 0.5})`)
              : (vbWave ? vbWave + '60' : `rgba(148, 163, 184, ${0.25 + (h / 14) * 0.35})`),
            animationDelay: `${i * 60}ms`,
            animationDuration: `${600 + (i % 3) * 200}ms`,
          }}
        />
      ))}
    </div>
  );

  const playCircle = (
    <span className="sully-voice-bar-button shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-all duration-300"
      style={{
        backgroundColor: isVoicePlaying ? (vbBtn || '#10b981')
          : (vbBg ? 'rgba(255,255,255,0.25)' : 'rgba(148,163,184,0.2)'),
        boxShadow: isVoicePlaying
          ? `0 2px 8px ${vbBtn ? vbBtn + '4D' : 'rgba(16,185,129,0.3)'}`
          : 'none',
      }}>
      {audioUrl
        ? (isVoicePlaying ? <Pause size={12} weight="fill" color="white" />
          : <Play size={12} weight="fill" color={vbBtn || '#64748b'} className="ml-0.5" />)
        // Text-only voice messages do NOT have a play button.
        : <Waveform size={14} weight="regular" color={vbBtn || '#64748b'} aria-hidden="true" />}
    </span>
  );

  return (
    <div className="sully-voice-bar-shell sully-user-voice-message relative z-10 w-[260px] max-w-full">
      <div
        className="sully-voice-bar flex items-center gap-2.5 w-full px-3 py-2 rounded-2xl transition-all duration-300 select-none"
        style={{
          background: isVoicePlaying
            ? (vbActiveBg || 'linear-gradient(135deg, rgba(16,185,129,0.12) 0%, rgba(52,211,153,0.08) 100%)')
            : (vbBg || 'linear-gradient(135deg, rgba(0,0,0,0.03) 0%, rgba(0,0,0,0.06) 100%)'),
          border: isVoicePlaying
            ? `1px solid ${vbBtn ? vbBtn + '33' : 'rgba(16,185,129,0.2)'}`
            : '1px solid rgba(0,0,0,0.05)',
        }}
      >
        {audioUrl ? (
          <button type="button" aria-label={isVoicePlaying ? '暂停录音' : '播放录音'}
            title={isVoicePlaying ? '暂停' : '播放'}
            onClick={event => { event.stopPropagation(); togglePlayback(); }}
            className="min-w-0 flex-1 flex items-center gap-2.5 active:scale-[0.97] transition-transform">
            {playCircle}
            {waveform}
          </button>
        ) : (
          <div className="min-w-0 flex-1 flex items-center gap-2.5" aria-label="仅转写，无可播放录音">
            {playCircle}
            {waveform}
          </div>
        )}
        <button type="button"
          className={`sully-voice-bar-toggle shrink-0 ml-0.5 px-1.5 py-0.5 rounded-lg text-[9px] font-medium transition-all ${showVoiceText ? 'ring-1 ring-current/20' : ''}`}
          style={{
            color: vbText || 'rgba(100,116,139,0.7)',
            backgroundColor: showVoiceText ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.04)',
          }}
          aria-label={showVoiceText ? '收起语音文字' : '转文字'}
          aria-expanded={showVoiceText}
          onClick={event => { event.stopPropagation(); setShowVoiceText(v => !v); }}>
          {showVoiceText ? '收起' : '转文字'}
        </button>
      </div>
      {showVoiceText && (
        <div className="sully-voice-bar-transcript mt-1.5 px-3 py-2 rounded-xl text-[11px] leading-relaxed whitespace-pre-wrap break-words select-text"
          style={{
            backgroundColor: vbBg || 'rgba(0,0,0,0.02)',
            color: vbText || '#475569',
            border: '1px solid rgba(0,0,0,0.04)',
          }}
          aria-label="语音消息文字">
          {voice.transcript || '（无转写内容）'}
        </div>
      )}
    </div>
  );
};

export default React.memo(UserVoiceBubble);
