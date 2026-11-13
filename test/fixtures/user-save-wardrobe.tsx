import '../../utils/userSaveBootstrap';
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import BeautyWardrobe from '../../components/appearance/BeautyWardrobe';
import { DB } from '../../utils/db';
import { readLibraryDecorations, type LibraryDecoration } from '../../utils/decorationLibrary';
import { activateUserSave, readUserSaves, USER_SAVE_ID } from '../../utils/userSaves';

const SECOND = '11111111-1111-4111-8111-111111111111';
const background = (index: number) => {
  const colors = ['#fcf0f3','#f6e9fc','#e7f3ff','#e9fbf3','#fff4dd','#ffeae2','#e8ebff','#f3f5e5','#fceaf4','#f2efff'];
  const color = colors[index % colors.length];
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><rect width="500" height="500" fill="' + color + '"/><circle cx="380" cy="150" r="160" fill="#fff" opacity=".28"/></svg>';
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
};

function VisualFixture() {
  const [items, setItems] = useState<LibraryDecoration[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const initialize = async () => {
      const registry = readUserSaves();
      if (registry.activeId === 'original' && registry.saves.length === 1) {
        const presets = Array.from({ length: 10 }, (_, index) => ({
          _libraryId: 'visual-background-' + index,
          format: 'sullyos-chat-decoration' as const,
          version: 1 as const,
          name: '我的聊天背景',
          parts: { background: { image: background(index), style: 'plain' as const } },
        }));
        await DB.saveAssetBatch([
          { id: 'chat_decoration_presets_v1', data: JSON.stringify(presets) },
          ...presets.map(preset => ({ id: 'decoration_origin_' + preset._libraryId, data: JSON.stringify({ kind: 'self' }) })),
        ]);
        localStorage.setItem('sully_image_api_v1', JSON.stringify({ apiKey: 'visual-test-only' }));
        await activateUserSave(SECOND, { name: '第二身份' });
        return;
      }
      const saved = await readLibraryDecorations();
      const imageSettings = localStorage.getItem('sully_image_api_v1');
      if (saved.length !== 10 || !imageSettings?.includes('visual-test-only'))
        throw Error('身份切换后聊天背景收藏或设置未保留：' + saved.length);
      if (!live) return;
      setItems(saved);
      document.body.dataset.identity = USER_SAVE_ID === SECOND ? 'B' : 'A';
      document.body.dataset.savedCount = String(saved.length);
    };
    void initialize().catch(e => {
      if (!live) return;
      setError(String(e));
      document.body.dataset.visualError = String(e);
    });
    return () => { live = false; };
  }, []);
  const entries = items.map(preset => ({
    id: preset._libraryId,
    name: preset.name,
    kind: 'chat-decoration' as const,
    attributionKey: async () => preset._libraryId,
    read: async () => preset,
    readLocal: async () => preset,
  }));
  return <>
    <div className="visual-header">聊天装扮</div>
    <div className="visual-tabs"><span>气泡</span><span>头像框</span><strong>聊天背景</strong><span>心象</span><span>提示音</span></div>
    <div className="visual-actions"><span>{USER_SAVE_ID === SECOND ? '第二身份' : '原有身份'}</span><button id="switch-to-original" type="button" onClick={() => void activateUserSave('original').catch(e => setError(String(e)))}>切回原身份</button></div>
    {error && <p role="alert">{error}</p>}
    {items.length > 0 && <BeautyWardrobe title="聊天背景" entries={entries} onApply={() => {}} />}
  </>;
}
createRoot(document.getElementById('root')!).render(<VisualFixture />);
