import React, { useEffect, useRef, useState } from 'react';

/**
 * 从用户原本的宝宝狗图标抽取黑色手绘线条。
 * 不重新绘制狗的轮廓、耳朵、毛发、圆章或「100%笨蛋」；
 * 只清除眼睛和嘴巴的少量像素，交给独立 SVG 做眨眼、张嘴。
 * 不调用生成式图片服务，也不生成新的上传图片。
 */
const ARTWORK = import.meta.env.BASE_URL + 'icons/baby-dog-512.png?v=babydog-20261105';
const SIZE = 512;
// 1254 是组件 SVG 的内部坐标；源仓库图标已按透明边界裁切，
// 五官位置必须按实际 512px 图标定位，不能直接沿用用户上传的大画布坐标。
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
          const chroma = Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) -
            Math.min(rgba[i], rgba[i + 1], rgba[i + 2]);
          let opacity = rgba[i + 3] * Math.pow(
            Math.max(0, Math.min(1, (222 - luminance) / 135)), 1.1,
          );
          // 去掉黄章内的色块底色，只留下黑色文字和轮廓线。
          if (luminance > 130 && chroma > 45) {
            opacity *= Math.max(0, 1 - (chroma - 45) / 90);
          }
          // 只清理原图旧眼、旧嘴，让新的五官逐帧替换而非叠成四只眼睛。
          if (
            inRegion(x, y, 354, 646, 442, 752) ||
            inRegion(x, y, 861, 644, 953, 755) ||
            inRegion(x, y, 484, 797, 866, 925)
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
          <ellipse cx="652" cy="501" rx="187" ry="184" fill="none"
            stroke="#666" strokeWidth="5" opacity="0.44" />
          <g className="sully-lineart-eyes-open" fill="#343434">
            <ellipse cx="396" cy="698" rx="26" ry="28" />
            <ellipse cx="908" cy="698" rx="26" ry="28" />
          </g>
          <g className="sully-lineart-eyes-closed" fill="none" stroke="#343434"
            strokeWidth="17" strokeLinecap="round">
            <path d="M366 699 Q396 714 427 698" />
            <path d="M879 698 Q908 715 938 698" />
          </g>
          <path className="sully-lineart-mouth-smile"
            d="M526 829 Q585 891 665 847 Q742 901 827 827"
            fill="none" stroke="#343434" strokeWidth="16" strokeLinecap="round" />
          <path className="sully-lineart-mouth-talking"
            d="M620 837 Q663 815 707 837 Q709 881 663 885 Q626 878 620 837 Z"
            fill="white" stroke="#343434" strokeWidth="13" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}
