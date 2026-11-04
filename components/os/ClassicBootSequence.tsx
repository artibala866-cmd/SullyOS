import React from 'react';
import JellyfishBootSequence from './JellyfishBootSequence';

// 保留旧存档中的 classic 开屏风格选项，但统一使用宝宝狗原图与同一套细腻动效。
// 两种旧配置统一使用同一套纯白色 CSS 狗狗开屏，避免夜空色块复现。
interface Props {
  dataReady: boolean;
  wallpaper?: string;
  onDone: () => void;
}

const ClassicBootSequence: React.FC<Props> = ({ dataReady, onDone }) =>
  <JellyfishBootSequence dataReady={dataReady} onDone={onDone} variant="night" />;

export default ClassicBootSequence;
