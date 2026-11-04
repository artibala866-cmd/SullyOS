import React, { useEffect, useRef, useState } from 'react';
import type { BabyDogExpression } from '../../utils/babyDogBootTimeline';

/**
 * 保留原 PNG 上的全部黑色线稿：毛发、轮廓、胸前「100%笨蛋」和原来的表情。
 * 眨眼时只遮住原有的两颗眼睛，同一位置换为弯弯眯眼。
 * 微笑线是原画上嘴唇，不能擦除；嘴巴只在其后方露出一小段舌头。
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
        {ready && expression !== 'normal' && (
          <svg className="sully-lineart-tongue" viewBox="0 0 512 512" aria-hidden="true">
            {/* 原画笑嘴是上唇，完整保留。小舌头从上唇中央下方露出来。 */}
            <path d="M267 333 Q270 346 278 347 Q287 347 290 333"
              fill="#fff" stroke="#343434" strokeWidth="5.6"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        <canvas className="sully-lineart-canvas" ref={canvasRef}
          width={SIZE} height={SIZE} aria-hidden="true" />
        <canvas className="sully-lineart-badge" ref={badgeRef}
          width={SIZE} height={SIZE} aria-hidden="true" />
        {ready && (
          <svg className="sully-lineart-sticker" viewBox="0 0 512 512" aria-hidden="true">
            {/* 原标志是圆形贴纸，不是孤零零的字：只给原稿字迹补回纸张圆边。 */}
            <ellipse cx="274" cy="179" rx="78.5" ry="74.5" fill="none"
              stroke="#343434" strokeWidth="3.15" />
          </svg>
        )}
        {ready && expression !== 'normal' && (
          <svg className="sully-lineart-features" viewBox="0 0 512 512" aria-hidden="true">
            {/* 只覆盖真正的两颗眼睛，不碰脸部轮廓与上唇；闭眼和睁眼始终同一位置。 */}
            <ellipse cx="162" cy="275" rx="18.5" ry="18" fill="#fff" />
            <ellipse cx="372" cy="275" rx="18.5" ry="18" fill="#fff" />
            <g fill="none" stroke="#343434" strokeLinecap="round"
              strokeWidth={expression === 'squint' ? 7.8 : 6.6}>
              <path d="M145 279 Q162 269 179 279" />
              <path d="M355 279 Q372 269 389 279" />
            </g>
          </svg>
        )}
      </div>
    </div>
  );
}
