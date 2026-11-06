import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BabyDogExpression } from '../../utils/babyDogBootTimeline';

/**
 * 保留原 PNG 上的全部黑色线稿：毛发、轮廓、胸前「100%笨蛋」和原来的表情。
 * 眨眼时只遮住原有的两颗眼睛，同一位置换为弯弯眯眼。
 * 微笑线是原画上嘴唇，不能擦除；嘴巴只在其后方露出一小段舌头。
 * 不调用生图，提取工作在浏览器 Canvas 内完成。
 */
const ARTWORK = import.meta.env.BASE_URL + 'icons/baby-dog-512.png?v=babydog-20261105';
const SIZE = 512;

/** 手工蜡笔笔触：固定种子的细碎油墨颗粒，切换表情不会随机闪烁。 */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

type Point = { x: number; y: number };
function roughCurve(ctx: CanvasRenderingContext2D, a: Point, b: Point, c: Point,
  width: number, seed: number) {
  const rand = makeRandom(seed);
  ctx.save();
  ctx.fillStyle = '#343434';
  for (let i = 0; i <= 142; i++) {
    const t = i / 142;
    const u = 1 - t;
    const x = u * u * a.x + 2 * u * t * b.x + t * t * c.x;
    const y = u * u * a.y + 2 * u * t * b.y + t * t * c.y;
    ctx.globalAlpha = .73 + rand() * .25;
    ctx.beginPath();
    ctx.arc(x + (rand() - .5) * 1.5, y + (rand() - .5) * 1.5,
      width * (.43 + rand() * .16), 0, Math.PI * 2);
    ctx.fill();
    if (i % 3 === 0) {
      ctx.globalAlpha = .12 + rand() * .25;
      ctx.fillRect(x + (rand() - .5) * (width + 2),
        y + (rand() - .5) * (width + 2), 1 + rand(), 1 + rand());
    }
  }
  ctx.restore();
}

function grain(ctx: CanvasRenderingContext2D, seed: number) {
  const ink = ctx.getImageData(0, 0, SIZE, SIZE);
  const data = ink.data;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4 + 3;
    if (!data[i]) continue;
    const noise = (Math.imul(x + seed, 73856093) ^
      Math.imul(y + seed * 3, 19349663)) >>> 0;
    // 原稿颗粒边缘不是 SVG 的纯色平滑轮廓：稳定的透墨/淡墨像素。
    if (noise % 23 === 0) data[i] = Math.round(data[i] * .28);
    else if (noise % 11 === 0) data[i] = Math.round(data[i] * .67);
  }
  ctx.putImageData(ink, 0, 0);
}

function roughBadge(ctx: CanvasRenderingContext2D) {
  const rand = makeRandom(2187);
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = '#343434';
  for (let i = 0; i < 420; i++) {
    const angle = i * Math.PI * 2 / 420;
    ctx.globalAlpha = .74 + rand() * .22;
    ctx.beginPath();
    ctx.arc(274 + Math.cos(angle) * 78.5 + (rand() - .5) * .8,
      206 + Math.sin(angle) * 74.5 + (rand() - .5) * .8,
      1.5 + rand() * .5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  grain(ctx, 31);
}


type Props = {
  expression: BabyDogExpression;
  mirrored: boolean;
};

export default function OriginalDogLineart({ expression, mirrored }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const badgeRef = useRef<HTMLCanvasElement>(null);
  const eyesRef = useRef<HTMLCanvasElement>(null);
  const tongueRef = useRef<HTMLCanvasElement>(null);
  const stickerRef = useRef<HTMLCanvasElement>(null);
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


  useLayoutEffect(() => {
    if (!ready) return;
    const sticker = stickerRef.current?.getContext('2d');
    if (sticker) roughBadge(sticker);
    const eyeCtx = eyesRef.current?.getContext('2d');
    if (eyeCtx) {
      eyeCtx.clearRect(0, 0, SIZE, SIZE);
      if (expression === 'blink' || expression === 'squint') {
        // 遮住原图眼睛的小圆点，白底面积限制在眼睛附近，不碰原图毛边和笑嘴。
        eyeCtx.fillStyle = '#fff';
        eyeCtx.beginPath();
        eyeCtx.ellipse(160, 297, 19, 19, 0, 0, Math.PI * 2);
        eyeCtx.ellipse(370, 292, 19, 19, 0, 0, Math.PI * 2);
        eyeCtx.fill();
        const lifted = expression === 'squint';
        roughCurve(eyeCtx, {x: 143, y: 299}, {x: 160, y: lifted ? 284 : 304},
          {x: 177, y: 299}, lifted ? 7.6 : 6.3, 1029);
        roughCurve(eyeCtx, {x: 353, y: 294}, {x: 370, y: lifted ? 279 : 299},
          {x: 387, y: 294}, lifted ? 7.6 : 6.3, 2057);
        grain(eyeCtx, 17);
      }
    }
    const tongueCtx = tongueRef.current?.getContext('2d');
    if (tongueCtx) {
      tongueCtx.clearRect(0, 0, SIZE, SIZE);
      if (expression === 'tongue' || expression === 'squint') {
        // 让舌头从原画上唇后方伸出，底层原画和上唇始终保持原样。
        roughCurve(tongueCtx, {x: 266, y: 349}, {x: 267, y: 380},
          {x: 278, y: 378}, 5.4, 3061);
        roughCurve(tongueCtx, {x: 278, y: 378}, {x: 290, y: 380},
          {x: 291, y: 349}, 5.4, 4093);
        grain(tongueCtx, 59);
      }
    }
  }, [expression, ready]);

  return (
    <div className="sully-lineart" data-line-ready={ready}
      data-expression={expression} data-mirrored={mirrored} role="img"
      aria-label="原画宝宝狗，胸前保留100%笨蛋，自然眨眼和吐舌头">
      <div className="sully-lineart-flip">
        {ready && (expression === 'tongue' || expression === 'squint') && (
          <canvas className="sully-lineart-tongue" ref={tongueRef} width={SIZE}
            height={SIZE} data-textured="true" aria-hidden="true" />
        )}
        <canvas className="sully-lineart-canvas" ref={canvasRef}
          width={SIZE} height={SIZE} aria-hidden="true" />
        <canvas className="sully-lineart-badge" ref={badgeRef}
          width={SIZE} height={SIZE} aria-hidden="true" />
        {ready && (
          <canvas className="sully-lineart-sticker" ref={stickerRef} width={SIZE}
            height={SIZE} data-textured="true" aria-hidden="true" />
        )}
        {ready && (expression === 'blink' || expression === 'squint') && (
          <canvas className="sully-lineart-features" ref={eyesRef} width={SIZE}
            height={SIZE} data-eye-count="2" data-textured="true" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
