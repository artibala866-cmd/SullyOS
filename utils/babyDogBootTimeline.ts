/** 参考用户 8.18s 原视频逐段校对的时间线（毫秒）。不涉及聊天系统。 */
export type BabyDogExpression = 'normal' | 'blink' | 'squint';
export type BabyDogLabel = 'none' | 'left' | 'right' | 'bottom';

export type BabyDogFrame = {
  expression: BabyDogExpression;
  mirrored: boolean;
  label: BabyDogLabel;
  welcome: boolean;
};

/** 仅切换原有一对眼睛及一个嘴型，不能叠加两个表情层。 */
export function getBabyDogFrame(timeMs: number): BabyDogFrame {
  const t = Math.max(0, timeMs);
  let expression: BabyDogExpression = 'normal';
  if ((t >= 2820 && t < 3290) || (t >= 4080 && t < 4450)) expression = 'blink';
  if (t >= 5330 && t < 6770) expression = 'squint';

  let label: BabyDogLabel = 'none';
  if (t >= 330 && t < 615) label = 'left';
  if (t >= 615 && t < 980) label = 'right';
  if (t >= 980 && t < 1260) label = 'left';
  if (t >= 1260 && t < 1760) label = 'right';
  if (t >= 6840 && t < 7350) label = 'bottom';

  const welcome = (t >= 1820 && t < 2780) ||
    (t >= 3380 && t < 4040) ||
    (t >= 4550 && t < 5260) ||
    (t >= 7400);

  return {
    expression,
    mirrored: t >= 5830 && t < 6780,
    label,
    welcome,
  };
}
