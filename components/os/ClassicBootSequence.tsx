import React from 'react';
import JellyfishBootSequence from './JellyfishBootSequence';

// 保留旧存档中的 classic 开屏风格选项，但统一使用宝宝狗原图与同一套细腻动效。
// 夜空只改变背景配色，不再渲染旧版宇宙粒子、旧 Logo 或壁纸蒙层。
interface Props {
  dataReady: boolean;
  wallpaper?: string;
  onDone: () => void;
}

const ClassicBootSequence: React.FC<Props> = ({ dataReady, onDone }) =>
  <JellyfishBootSequence dataReady={dataReady} onDone={onDone} variant="night" />;

export default ClassicBootSequence;
