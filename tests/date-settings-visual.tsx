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
function Harness() {
  const [char, setChar] = useState(base);
  const patch = (_id: string, value: any) =>
    setChar((prev: any) => {
      const changes = typeof value === 'function' ? value(prev) : value;
      const next = { ...prev, ...changes };
      charMirror = next;
      return next;
    });
  const os = {
    characters: [char], userProfile: { name: '用户' }, theme: {},
    appearancePresets: [], addToast: () => {}, registerBackHandler: () => () => {},
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
    settings.scrollIntoView({ block: 'start', behavior: 'instant' });
    const scroller = host.querySelector<HTMLElement>('[data-testid="date-settings-scroll"]');
    if (scroller) scroller.scrollTop = Math.max(0, scroller.scrollTop - 12);
    const gridBounds = slots.map(s => s.getBoundingClientRect());
    const fit = document.documentElement.scrollWidth <= innerWidth && gridBounds.every(r => r.width >= 130 && r.left >= -1 && r.right <= innerWidth + 1);
    const clearOk = scenario !== 'clear' || (!charMirror.dateBackground && !!charMirror.dateSceneBackgrounds?.bedroom);
    const imagesOk = scenario === 'empty' ? pictureCount === 0 : pictureCount === 4;
    const labelsOk = realLabels.join('|') === '默认|室外|卧室|浴室|厨房|工作';
    const report = { scenario, keys, realLabels, pictureCount, fit, imagesOk,
      defaultOriginallyPresent: scenario === 'empty' ? !original : original.startsWith('data:image/svg+xml'),
      noExtraSections, clearOk,
      scrollbarWidth: scroller?.clientWidth, viewport: [innerWidth,innerHeight],
      sceneRects: gridBounds.map(r=>[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)]),
      sectionY: Math.round(rect.y) };
    const success = JSON.stringify(keys) === JSON.stringify(expected) &&
      labelsOk && fit && imagesOk && noExtraSections && clearOk && report.defaultOriginallyPresent;
    document.body.dataset.dateSettingsReady = String(success);
    let output = document.getElementById('date-settings-browser-report');
    if (!output) { output = document.createElement('output'); output.id = 'date-settings-browser-report'; output.hidden = true; document.body.append(output); }
    output.textContent = JSON.stringify(report);
  };
  setTimeout(advance, 400);
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
