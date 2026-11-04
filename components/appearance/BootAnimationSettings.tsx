import React from 'react';
import type { OSTheme } from '../../types';

// 旧 warm / classic 皮肤值继续兼容，两种入口使用同一款纯白小狗开屏。
// 只展示唯一真正生效的样式，避免两张一样的预览卡片误导。
export default function BootAnimationSettings({theme: _theme, updateTheme: _updateTheme}: {
  theme: OSTheme;
  updateTheme: (patch: Partial<OSTheme>) => void;
}) {
  return <div className="mt-5 border-t border-slate-100 pt-4">
    <h3 className="text-xs font-bold text-slate-700">开机动画</h3>
    <p className="mt-1 text-xs leading-relaxed text-slate-500">纯白背景 · 白色小狗轻轻跳舞。可在「动画与过场」中关闭。</p>
  </div>;
}
