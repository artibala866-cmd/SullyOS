import React, { useEffect, useRef, useState } from 'react';
import type { BabyDogExpression } from '../../utils/babyDogBootTimeline';

/**
 * 保留原 PNG 上的全部黑色线稿：毛发、轮廓、胸前「100%笨蛋」和原来的表情。
 * 眨眼时只在原眼睛所在的小区域盖上纯白底，再描画同一对眯眼。
 * 张嘴时也只盖住原有的嘴部笔画，不往原脸上叠出第二张嘴。
 * 不调用生图，提取工作在浏览器 Canvas 内完成。
 */
const ARTWORK = import.meta.env.BASE_URL + 'icons/baby-dog-512.png?v=babydog-20261105';
const SIZE = 512;

type Props = {
  expression: BabyDogExpression;
  mirrored: boolean;
};

export default function OriginalDogLineart({ expression, mirrored }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const badgeRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d', { willReadFrequently: true });
      const badgeCtx = badgeRef.current?.getContext('2d');
      if (!ctx || !badgeCtx) return;
      try {
        ctx.clearRect(0, 0, SIZE, SIZE);
        ctx.drawImage(image, 0, 0, SIZE, SIZE);
        const pixels = ctx.getImageData(0, 0, SIZE, SIZE);
        const rgba = pixels.data;
        const badgePixels = badgeCtx.createImageData(SIZE, SIZE);
        const badgeRGBA = badgePixels.data;
        for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
          const i = (y * SIZE + x) * 4;
          const brightness = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
          const chroma = Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) -
            Math.min(rgba[i], rgba[i + 1], rgba[i + 2]);
          let opacity = rgba[i + 3] *
            Math.pow(Math.max(0, Math.min(1, (222 - brightness) / 135)), 1.1);
          // 白纸和黄色填色透明，深色蜡笔痕迹与「100%笨蛋」原字照原样留下。
          if (brightness > 130 && chroma > 45) {
            opacity *= Math.max(0, 1 - (chroma - 45) / 90);
          }
          rgba[i] = 52;
          rgba[i + 1] = 52;
          rgba[i + 2] = 52;
          rgba[i + 3] = Math.round(opacity);
          // 仅按原画裁出胸前徽章图层；左右翻转时反向镜像，使「100%笨蛋」始终可读。
          // 两张画布正常叠放时，合起来就是同一张未经重新绘制的线稿。
          const badgeArea = Math.pow((x - 274) / 91, 2) + Math.pow((y - 179) / 82, 2) <= 1;
          if (badgeArea) {
            badgeRGBA[i] = rgba[i];
            badgeRGBA[i + 1] = rgba[i + 1];
            badgeRGBA[i + 2] = rgba[i + 2];
            badgeRGBA[i + 3] = rgba[i + 3];
            rgba[i + 3] = 0;
          }
        }
        ctx.putImageData(pixels, 0, 0);
        badgeCtx.putImageData(badgePixels, 0, 0);
        setReady(true);
      } catch (error) {
        console.warn('[BabyDog] lineart extraction failed', error);
      }
    };
    image.onerror = () => console.warn('[BabyDog] source lineart missing:', ARTWORK);
    image.src = ARTWORK;
    return () => { cancelled = true; image.onload = null; image.onerror = null; };
  }, []);

  return (
    <div className="sully-lineart" data-line-ready={ready}
      data-expression={expression} data-mirrored={mirrored} role="img"
      aria-label="原画宝宝狗，胸前保留100%笨蛋，眨眼并张嘴">
      <div className="sully-lineart-flip">
        <canvas className="sully-lineart-canvas" ref={canvasRef}
          width={SIZE} height={SIZE} aria-hidden="true" />
        <canvas className="sully-lineart-badge" ref={badgeRef}
          width={SIZE} height={SIZE} aria-hidden="true" />
        {ready && expression !== 'normal' && (
          <svg className="sully-lineart-features" viewBox="0 0 512 512" aria-hidden="true">
            {/* 两个小白底完全盖住原来两个点眼睛，而不是新增一对。 */}
            <path fill="#fff" d="M138 239 H188 V308 H138 Z M345 230 H403 V303 H345 Z" />
            {expression === 'blink' ? (
              <g fill="none" stroke="#343434" strokeLinecap="round" strokeWidth="10">
                <path d="M148 270 Q163 263 177 270" />
                <path d="M357 261 Q371 254 385 261" />
              </g>
            ) : (
              <g fill="#343434" stroke="#343434" strokeLinejoin="round" strokeWidth="3">
                <path d="M145 260 Q161 257 180 262 L149 273 Q164 270 145 260 Z" />
                <path d="M389 253 Q373 251 354 261 L385 273 Q371 267 389 253 Z" />
              </g>
            )}
            {/* 旧鼻子位于 y≈300，保留；只用白底替换其下方原笑嘴。 */}
            <path fill="#fff" d="M201 304 H348 V359 H201 Z" />
            <path d="M252 322 Q273 315 294 322 Q299 335 296 352 H251 Q246 338 252 322 Z"
              fill="#fff" stroke="#343434" strokeWidth="7" strokeLinejoin="round" />
          </svg>
        )}
      </div>
    </div>
  );
}
