import React, { useEffect, useMemo, useRef, useState } from 'react';
import './BootSequence.css';
import { trackEvent } from '../../utils/analytics';
import OriginalDogLineart from './OriginalDogLineart';
import { BABY_DOG_DURATION_MS, getBabyDogFrame } from '../../utils/babyDogBootTimeline';

// 纯白开屏：提取用户上传的宝宝狗原稿线条，参考视频做轻柔放大和五官动画。
const BOOT_SEEN_KEY = 'sullyos_boot_seen_session';

interface Props {
  poster?: string;
  variant?: 'warm' | 'night';
  dataReady: boolean;
  onDone: () => void;
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const JellyfishBootSequence: React.FC<Props> = ({ dataReady, onDone, poster, variant = 'warm' }) => {
  const [posterLoaded, setPosterLoaded] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const showPoster = !!poster && !posterFailed;
  const firstThisSession = useMemo(() => {
    try { return !sessionStorage.getItem(BOOT_SEEN_KEY); } catch { return true; }
  }, []);
  const reduced = useMemo(() => prefersReducedMotion(), []);
  const cinematic = firstThisSession && !reduced;
  // 普通宝宝狗首屏 3.9 秒，重复进入只保留快速亮相；节日海报保留原停留时长。
  // 数据未就绪仍等待数据，轻触跳过及低动态偏好继续有效。
  const HOLD = showPoster ? 8200 : reduced ? 360 : cinematic ? BABY_DOG_DURATION_MS : 950;
  const EXIT = cinematic ? 260 : 180;
  const [phase, setPhase] = useState<'enter' | 'exit'>('enter');
  const [videoFrame, setVideoFrame] = useState(() => getBabyDogFrame(0));
  const previousFrameRef = useRef(videoFrame);
  const startRef = useRef(0);
  if (startRef.current === 0) {
    startRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  useEffect(() => {
    try { sessionStorage.setItem(BOOT_SEEN_KEY, '1'); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (phase === 'exit') return;
    let raf = 0;
    const tick = () => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const elapsed = now - startRef.current;
      if (!showPoster && !reduced) {
        const next = getBabyDogFrame(elapsed);
        const prev = previousFrameRef.current;
        if (next.expression !== prev.expression || next.mirrored !== prev.mirrored ||
            next.label !== prev.label || next.welcome !== prev.welcome) {
          previousFrameRef.current = next;
          setVideoFrame(next);
        }
      }
      if (dataReady && (!showPoster || posterLoaded) && elapsed >= HOLD) {
        setPhase('exit');
        const waited = now - startRef.current;
        trackEvent('冷启动等待数据就绪', {
          等待档位: waited < 1000 ? '<1s' : waited < 3000 ? '1-3s' : waited < 8000 ? '3-8s' : '8s+',
          开场版本: cinematic ? '完整版' : '极短版',
        });
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dataReady, phase, HOLD, showPoster, posterLoaded, reduced]);

  useEffect(() => {
    if (phase !== 'exit') return;
    const timer = setTimeout(onDone, EXIT);
    return () => clearTimeout(timer);
  }, [phase, EXIT, onDone]);

  const skip = () => {
    if (phase !== 'exit') {
      setPhase('exit');
      trackEvent('跳过开机动画', {
        数据是否已就绪: dataReady ? '是' : '否',
        开场版本: cinematic ? '完整版' : '极短版',
      });
    }
  };

  return (
    <div
      className={`sully-boot${showPoster ? ' sully-boot-mid-autumn' : variant === 'night' ? ' sully-boot-night' : ''}`}
      data-phase={phase}
      data-cinematic={cinematic}
      data-motion={!reduced}
      data-variant={showPoster ? 'poster' : variant}
      onClick={skip}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); skip(); } }}
      role="button"
      tabIndex={0}
      aria-label="宝宝狗，轻触进入"
      style={{ opacity: phase === 'exit' ? 0 : 1, transition: `opacity ${EXIT}ms ease-in` }}
    >
      {showPoster ? (
        <div className="sully-boot-poster-scene">
          <div className="sully-boot-poster-frame">
            <img src={poster} alt="宝宝狗·中秋，月亮上的猫与玉兔" className="sully-boot-poster" draggable={false}
              onLoad={() => {
                startRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
                setPosterLoaded(true);
              }} onError={() => setPosterFailed(true)} />
            <p className="sully-boot-poster-greeting">欢迎回家</p>
          </div>
        </div>
      ) : (
        <div className="sully-boot-scene">
          <div className="sully-boot-center">
            <div className="sully-boot-artwork" data-label={reduced ? "none" : videoFrame.label}>
              <OriginalDogLineart expression={reduced ? "normal" : videoFrame.expression}
                mirrored={!reduced && videoFrame.mirrored} />
              <span className="sully-boot-side-label">dog</span>
            </div>
            <p className="sully-boot-welcome"
              data-visible={reduced || videoFrame.welcome}>Welcome home.</p>
          </div>
        </div>
      )}
    </div>
  );
};
export default JellyfishBootSequence;
