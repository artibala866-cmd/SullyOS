/** 宝宝狗开屏：快速入场、表情节拍、完整收尾。毫秒时间与 CSS 的 3.9s 动画同步。 */
export const BABY_DOG_DURATION_MS = 3900;

export type BabyDogExpression = 'normal' | 'blink' | 'squint' | 'tongue';
export type BabyDogLabel = 'none' | 'left' | 'right' | 'bottom';

export type BabyDogFrame = {
  expression: BabyDogExpression;
  mirrored: boolean;
  label: BabyDogLabel;
  welcome: boolean;
};

/** 一次只渲染一种五官状态；避免闭眼/吐舌头同时叠出鬼影或整只狗突然翻转。 */
export function getBabyDogFrame(timeMs: number): BabyDogFrame {
  const t = Math.max(0, timeMs);
  let expression: BabyDogExpression = 'normal';

  if ((t >= 1150 && t < 1280) ||
      (t >= 1820 && t < 1950) ||
      (t >= 2780 && t < 2910)) expression = 'blink';
  if ((t >= 1420 && t < 1670) ||
      (t >= 2290 && t < 2520)) expression = 'squint';
  if ((t >= 2020 && t < 2250) ||
      (t >= 3000 && t < 3170)) expression = 'tongue';

  // 文案只在两个乐句处出现，不再每几百毫秒左右闪烁。
  const label: BabyDogLabel = t >= 3250 ? 'bottom' : t >= 570 && t < 1360 ? 'right' : 'none';
  return {
    expression,
    mirrored: false,
    label,
    welcome: t >= 3250,
  };
}
