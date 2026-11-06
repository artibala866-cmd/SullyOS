import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OSPreviewProvider } from '../context/OSContext';
import DateSettings from '../components/date/DateSettings';

const sceneImage = (primary: string, secondary: string, text: string) =>
  'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
    <rect width="640" height="360" fill="${primary}"/><rect x="38" y="44" width="564" height="268" rx="18" fill="${secondary}" opacity=".78"/>
    <rect x="92" y="90" width="195" height="148" rx="13" fill="white" opacity=".35"/>
    <circle cx="457" cy="171" r="75" fill="white" opacity=".30"/>
    <text x="320" y="292" font-size="33" text-anchor="middle" fill="#333" font-family="sans-serif">${text}</text>
  </svg>`);
const scenario = new URLSearchParams(location.search).get('scenario') || 'filled';
const base = {
  id: 'browser-scene-test', name: '测试角色', avatar: '',
  dateAppearance: { preset: 'none' },
  dateBackground: scenario === 'empty' ? undefined : sceneImage('#efeee8', '#bebbb3', '默认'),
  dateSceneBackgrounds: scenario === 'empty' ? {} : {
    outdoor: sceneImage('#d4ded6', '#95b59f', '室外'),
    bedroom: sceneImage('#e9dadc', '#cbadb4', '卧室'),
    kitchen: sceneImage('#f3ebc9', '#dbc783', '厨房'),
  },
  sprites: { normal: sceneImage('#d6d6d6', '#a3a3a3', '角色') },
  dateStyleConfig: {},
} as any;
const host = document.getElementById('visual')!;
let charMirror = base;
const debugEvents: string[] = [];
function Harness() {
  const [char, setChar] = useState(base);
  const patch = (_id: string, value: any) =>
    setChar((prev: any) => {
      const changes = typeof value === 'function' ? value(prev) : value;
      const next = { ...prev, ...changes };
      charMirror = next;
      debugEvents.push('patch ' + Object.keys(changes).join(','));
      return next;
    });
  const os = {
    characters: [char], userProfile: { name: '用户' }, theme: {},
    appearancePresets: [], addToast: (message: string, kind: string) => { debugEvents.push('toast ' + kind + ': ' + message); }, registerBackHandler: () => () => {},
    updateCharacter: patch, updateTheme: () => {}, exportAppearancePreset: () => {},
    importAppearancePreset: () => {},
  } as any;
  return <OSPreviewProvider value={os}><DateSettings char={char} onBack={() => {}} /></OSPreviewProvider>;
}
createRoot(host).render(<Harness />);

function check() {
  const settings = [...document.querySelectorAll<HTMLDetailsElement>('details')]
    .find(section => section.querySelector('summary')?.textContent?.trim() === '背景');
  if (!settings) return false;
  settings.open = true;
  const slots = [...settings.querySelectorAll<HTMLElement>('[data-date-scene]')];
  if (slots.length !== 6) return false;
  const expected = ['default', 'outdoor', 'bedroom', 'bathroom', 'kitchen', 'work'];
  const keys = slots.map(slot => slot.dataset.dateScene);
  const realLabels = slots.map(slot => slot.querySelector('button[aria-pressed]')?.textContent?.trim());
  const original = slots[0].querySelector('img')?.getAttribute('src') || '';
  const pictureCount = slots.filter(slot => !!slot.querySelector('img')).length;
  const noExtraSections = [...document.querySelectorAll('summary')]
    .filter(el => el.textContent?.trim() === '背景' || el.textContent?.includes('基础场景背景')).length === 1;
  if (scenario === 'clear') {
    const erase = settings.querySelector<HTMLButtonElement>('button[aria-label="清除默认背景"]');
    if (erase) erase.click();
  }
  const advance = () => {
    const rect = settings.getBoundingClientRect();
    if (scenario !== 'top') settings.scrollIntoView({ block: 'start', behavior: 'instant' });
    const scroller = host.querySelector<HTMLElement>('[data-testid="date-settings-scroll"]');
    if (scroller && scenario !== 'top') scroller.scrollTop = Math.max(0, scroller.scrollTop - 12);
    const gridBounds = slots.map(s => s.getBoundingClientRect());
    const fit = document.documentElement.scrollWidth <= innerWidth && gridBounds.every(r => r.width >= 130 && r.left >= -1 && r.right <= innerWidth + 1);
    const clearOk = scenario !== 'clear' ||
      (!charMirror.dateBackground && !slots[0].querySelector('img') && !!charMirror.dateSceneBackgrounds?.bedroom);
    const uploadOk = scenario !== 'upload' || (
      !!charMirror.dateSceneBackgrounds?.bathroom?.startsWith('blobref:') &&
      !!charMirror.dateSceneBackgrounds?.work?.startsWith('blobref:') &&
      !!charMirror.dateSceneBackgrounds?.bedroom &&
      !!slots[3].querySelector('img') && !!slots[5].querySelector('img')
    );
    const imagesOk = scenario === 'empty' ? pictureCount === 0 : scenario === 'upload' ? pictureCount === 6 : pictureCount === 4;
    const labelsOk = realLabels.join('|') === '默认|室外|卧室|浴室|厨房|工作';
    const report = { scenario, keys, realLabels, pictureCount, fit, imagesOk, uploadOk,
      debugEvents, storedScenes: Object.fromEntries(Object.entries(charMirror.dateSceneBackgrounds || {}).map(([k, v]) => [k, String(v).slice(0, 30)])),
      defaultOriginallyPresent: scenario === 'empty' ? !original : original.startsWith('data:image/svg+xml'),
      noExtraSections, clearOk,
      scrollbarWidth: scroller?.clientWidth, viewport: [innerWidth,innerHeight],
      sceneRects: gridBounds.map(r=>[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)]),
      sectionY: Math.round(rect.y) };
    const success = JSON.stringify(keys) === JSON.stringify(expected) &&
      labelsOk && fit && imagesOk && noExtraSections && clearOk && uploadOk && report.defaultOriginallyPresent;
    document.body.dataset.dateSettingsReady = String(success);
    let output = document.getElementById('date-settings-browser-report');
    if (!output) { output = document.createElement('output'); output.id = 'date-settings-browser-report'; output.hidden = true; document.body.append(output); }
    output.textContent = JSON.stringify(report);
  };
  if (scenario === 'upload') {
    // Exercise the real image-upload handler + IndexedDB blob storage, not merely mocked state.
    void (async () => {
      try {
        const upload = async (key: string) => {
          const button = settings.querySelector<HTMLButtonElement>(`[data-date-scene="${key}"] button[aria-label^="上传"]`);
          if (!button) throw Error('missing upload button: ' + key);
          button.click();
          debugEvents.push('clicked ' + key);
          await new Promise(resolve => setTimeout(resolve, 75));
          const input = document.querySelector<HTMLInputElement>('input[type="file"][accept="image/*"]');
          if (!input) throw Error('missing file input');
          const text = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="gray"/></svg>';
          const dt = new DataTransfer();
          dt.items.add(new File([text], `${key}.svg`, { type: 'image/svg+xml' }));
          input.files = dt.files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          debugEvents.push('changed ' + key + ' input.files=' + input.files?.length);
          await new Promise(resolve => setTimeout(resolve, 300));
        };
        await upload('bathroom');
        await upload('work');
        await new Promise(resolve => setTimeout(resolve, 850));
        advance();
      } catch (error) {
        document.body.dataset.dateSettingsReady = 'false';
        const output = document.createElement('output');
        output.id = 'date-settings-browser-error'; output.textContent = String(error);
        document.body.append(output);
      }
    })();
  } else {
    setTimeout(advance, 400);
  }
  return true;
}
const started = Date.now();
const poll = () => {
  if (check()) return;
  if (Date.now() - started > 7500) {
    document.body.dataset.dateSettingsReady = 'false';
    return;
  }
  setTimeout(poll, 120);
};
setTimeout(poll, 700);
