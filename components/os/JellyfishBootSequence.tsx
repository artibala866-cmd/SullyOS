import React, { useEffect, useMemo, useRef, useState } from 'react';
import './BootSequence.css';
import { trackEvent } from '../../utils/analytics';

// 纯白开屏：CSS 绘制白色小狗，各部位独立扭动；不依赖图片和 AI 生图。
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
  const HOLD = cinematic ? 1400 : 420;
  const EXIT = cinematic ? 380 : 220;
  const [phase, setPhase] = useState<'enter' | 'exit'>('enter');
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
      if (dataReady && (!showPoster || posterLoaded) && now - startRef.current >= HOLD) {
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
  }, [dataReady, phase, HOLD, showPoster, posterLoaded]);

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
      data-dancing={!reduced}
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
          <div className="sully-boot-art" role="img" aria-label="一只白色小狗在开心地跳舞">
            <div className="sully-boot-dog" aria-hidden="true">
              <div className="sully-dog-tail" />
              <div className="sully-dog-body" />
              <div className="sully-dog-ear left" />
              <div className="sully-dog-ear right" />
              <div className="sully-dog-head">
                <span className="sully-dog-eye left" />
                <span className="sully-dog-eye right" />
                <span className="sully-dog-nose" />
                <span className="sully-dog-mouth left" />
                <span className="sully-dog-mouth right" />
              </div>
              <div className="sully-dog-paw left" />
              <div className="sully-dog-paw right" />
              <div className="sully-dog-foot left" />
              <div className="sully-dog-foot right" />
            </div>
          </div>
          <h1 className="sully-boot-dog-wordmark">宝宝狗</h1>
        </div>
      )}
    </div>
  );
};
export default JellyfishBootSequence;
