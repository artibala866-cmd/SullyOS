import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DraggableNavigationBall } from '../../components/os/NavigationBall';
import { setNavigationBallSlot } from '../../utils/navigationBall';
import { AppID, type APIConfig, type ApiPreset } from '../../types';
import { configFromPreset } from '../../utils/apiPresetSwitch';

// Real floating-menu component, mock-safe API values, no network calls or app navigation.
const first: APIConfig = { baseUrl: 'https://demo.invalid/v1', apiKey: 'demo-only', model: 'gemini-4-argon', stream: true, temperature: 0.85 };
const presets: ApiPreset[] = [
  { id: 'one', name: '星桥', group: '日常', config: first },
  { id: 'two', name: '星期五', group: '剧情', config: { ...first, baseUrl: 'https://other.invalid/v1', model: 'gemini-4-flash' } },
  { id: 'three', name: '小鸡', group: '轻量', config: { ...first, baseUrl: 'https://third.invalid/v1', model: 'gemini-3-flash' } },
];

function VisualFixture() {
  const [config, setConfig] = useState<APIConfig>(first);
  const [message, setMessage] = useState('');
  useEffect(() => {
    // The real slot store is used; nothing here writes any API credentials.
    setNavigationBallSlot(0, { appId: AppID.Date });
    setNavigationBallSlot(1, { appId: AppID.Music });
    const mode = new URLSearchParams(window.location.search).get('view') || 'main';
    const id = window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>('.navigation-ball-toggle')?.click();
      window.setTimeout(() => {
        if (mode === 'api' || mode === 'manual') {
          document.querySelector<HTMLButtonElement>('.navigation-ball-api-entry')?.click();
        }
        window.setTimeout(() => {
          if (mode === 'manual') {
            document.querySelector<HTMLButtonElement>('.navigation-ball-api-actions button:first-child')?.click();
          }
          window.setTimeout(() => { document.documentElement.dataset.navVisualReady = 'true'; }, 140);
        }, 180);
      }, 180);
    }, 250);
    return () => window.clearTimeout(id);
  }, []);
  return <div className="visual-phone">
    <div className="visual-status"><span>6:25</span><span>●●● ▰ 87%</span></div>
    <div className="visual-header">剧情阅读</div>
    <span className="visual-caption">阅读演示 · 检查悬浮菜单遮挡</span>
    <div className="visual-story">
      <p>傍晚的风慢慢穿过窗帘，房间里还留着一点午后的暖意。你低头看了看手机，光标停在尚未发送的那句话后面。</p>
      <p>他没有催促，只是安静地等着。桌角的玻璃杯映出一点细碎的光，远处传来模糊的脚步声。</p>
      <p>“你刚才说的那件事，”他忽然问，“后来怎么样了？”</p>
      <p>你正要回答，门外突然响起很轻的一声敲门。空气像被短暂地按下了暂停键。</p>
      <p>不必为了调整设置离开这一页。剧情依然停留在这里，轻轻点开悬浮球就能选择需要的操作。</p>
      <p>光线渐暗，故事还在继续。</p>
    </div>
    <div className="visual-footer"><span>目录</span><span>文本</span><span>阅读设置</span></div>
    <DraggableNavigationBall
      onBack={() => setMessage('上一级')}
      onHome={() => setMessage('桌面')}
      onApi={() => setMessage('完整设置')}
      onConfigure={() => setMessage('自定义入口')}
      onShortcut={shortcut => setMessage(shortcut.appId)}
      characters={[]}
      apiPresets={presets}
      apiConfig={config}
      onSwitchPreset={preset => { setConfig(old => ({ ...old, ...configFromPreset(preset) })); setMessage('已切换：' + preset.name); }}
      onManualApi={patch => { setConfig(old => ({ ...old, ...patch })); setMessage('已保存'); }}
    />
    <output style={{ position: 'absolute', left: 8, bottom: 73, fontSize: 9, color: '#aaa' }}>{message}</output>
  </div>;
}
createRoot(document.getElementById('root')!).render(<VisualFixture />);
