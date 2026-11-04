import React, { useEffect, useRef, useState } from 'react';

/**
 * 从用户原本的宝宝狗图标抽取黑色手绘线条。
 * 不重新绘制狗的轮廓、耳朵、毛发、圆章或「100%笨蛋」；
 * 只清除眼睛和嘴巴的少量像素，交给独立 SVG 做眨眼、张嘴。
 * 不调用生成式图片服务，也不生成新的上传图片。
 */
const ARTWORK = import.meta.env.BASE_URL + 'icons/baby-dog-512.png?v=babydog-20261105';
const SIZE = 512;
const ORIGINAL = 1254;

const inRegion = (x: number, y: number, left: number, top: number, right: number, bottom: number) =>
  x > left / ORIGINAL * SIZE && x < right / ORIGINAL * SIZE &&
  y > top / ORIGINAL * SIZE && y < bottom / ORIGINAL * SIZE;

export default function OriginalDogLineart({ animate }: { animate: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      try {
        ctx.clearRect(0, 0, SIZE, SIZE);
        ctx.drawImage(image, 0, 0, SIZE, SIZE);
        const pixels = ctx.getImageData(0, 0, SIZE, SIZE);
        const rgba = pixels.data;
        for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
          const i = (y * SIZE + x) * 4;
          const luminance = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
          let opacity = rgba[i + 3] * Math.pow(
            Math.max(0, Math.min(1, (222 - luminance) / 135)), 1.1,
          );
          // 保留原本全部手绘线稿（包括胸前字样），仅为眨眼/嘴巴腾出原位置。
          if (
            inRegion(x, y, 429, 685, 505, 775) ||
            inRegion(x, y, 769, 680, 845, 765) ||
            inRegion(x, y, 533, 793, 775, 864)
          ) opacity = 0;
          rgba[i] = 52;
          rgba[i + 1] = 52;
          rgba[i + 2] = 52;
          rgba[i + 3] = Math.round(opacity);
        }
        ctx.putImageData(pixels, 0, 0);
        setReady(true);
      } catch (error) {
        console.warn('[BabyDog] original line extraction failed', error);
      }
    };
    image.onerror = () => console.warn('[BabyDog] original icon missing:', ARTWORK);
    image.src = ARTWORK;
    return () => { cancelled = true; image.onload = null; image.onerror = null; };
  }, []);

  return (
    <div className="sully-lineart" data-line-ready={ready} data-line-motion={animate} role="img"
      aria-label="原版宝宝狗手绘线稿，胸前写着100%笨蛋，正在眨眼微笑">
      <canvas className="sully-lineart-canvas" ref={canvasRef} width={SIZE} height={SIZE} aria-hidden="true" />
      {ready && (
        <svg className="sully-lineart-features" viewBox="0 0 1254 1254" aria-hidden="true">
          <g className="sully-lineart-eyes-open" fill="#343434">
            <ellipse cx="466" cy="729" rx="19" ry="22" />
            <ellipse cx="806" cy="720" rx="19" ry="22" />
          </g>
          <g className="sully-lineart-eyes-closed" fill="none" stroke="#343434"
            strokeWidth="17" strokeLinecap="round">
            <path d="M444 730 Q466 742 490 728" />
            <path d="M783 720 Q806 734 832 720" />
          </g>
          <path className="sully-lineart-mouth-smile"
            d="M547 802 Q588 859 649 818 Q689 856 748 805"
            fill="none" stroke="#343434" strokeWidth="16" strokeLinecap="round" />
          <path className="sully-lineart-mouth-talking"
            d="M608 814 Q653 788 696 814 Q700 851 654 858 Q611 849 608 814 Z"
            fill="white" stroke="#343434" strokeWidth="13" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}
