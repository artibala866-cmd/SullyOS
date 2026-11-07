import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OSPreviewProvider } from '../context/OSContext';
import DateSession from '../components/date/DateSession';
import DateSettings from '../components/date/DateSettings';

const params = new URLSearchParams(location.search);
const scenario = params.get('scenario') || 'portrait';
const errors: string[] = [];
window.addEventListener('error', e => errors.push(e.message));
window.addEventListener('unhandledrejection', e => errors.push(String(e.reason)));

const sprite = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="380" height="640" viewBox="0 0 380 640">
<path d="M75 220 Q10 280 0 640 H380 Q367 282 305 220Z" fill="#262a34"/>
<path d="M144 201 L142 290 242 292 237 199" fill="#d9c4bb"/>
<ellipse cx="190" cy="151" rx="92" ry="122" fill="#d9c4bb"/>
<path d="M96 174 Q64 12 183 7 Q316 6 285 176 L263 100 220 84 173 99 123 72Z" fill="#1a1c25"/>
<path d="M119 139 Q148 126 175 143 M210 143 Q241 129 268 143" stroke="#34343f" stroke-width="7" fill="none"/>
<path d="M160 209 Q192 223 219 205" stroke="#7c5454" stroke-width="3" fill="none"/>
<path d="M114 253 Q180 327 266 253 L315 440 380 640 H0 L65 440Z" fill="#292a31"/>
</svg>`);
const bg = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="560">
<rect width="1000" height="560" fill="#aca9a3"/><rect y="390" width="1000" height="170" fill="#575957"/>
<rect x="60" y="90" width="240" height="280" fill="#d8d6cf"/>
<rect x="650" y="60" width="240" height="290" fill="#7b7974"/></svg>`);
const initialChar: any = {
  id: 'portrait-landscape-independent', name: '测试角色', avatar: sprite,
  sprites: { normal: sprite }, dateBackground: bg,
  dateAppearance: { preset: 'none' },
  // This reproduces the actual recorded -10% portrait placement.
  spriteConfig: { scale: 1, x: 0, y: -10 },
  ...(scenario.includes('Legacy') || scenario === 'legacyLandscape'
    ? {} : { spriteConfigLandscape: { scale: 1, x: 10, y: 15 } }),
};
const host = document.getElementById('visual')!;
let latest = initialChar;
let screen = scenario.startsWith('settings') ? 'settings' : 'session';
let updateCount = 0;

function Harness() {
  const [char, setChar] = useState(initialChar);
  const [page, setPage] = useState(screen);
  const patch = (_id: string, changes: any) => {
    setChar((before: any) => {
      latest = { ...before, ...changes };
      updateCount++;
      return latest;
    });
  };
  const os = {
    characters: [char], userProfile: { name: '用户' }, theme: {}, apiConfig: {},
    addToast: () => {}, updateCharacter: patch, updateTheme: () => {},
    registerBackHandler: () => () => {}, appearancePresets: [],
    exportAppearancePreset: () => {}, importAppearancePreset: () => {},
  } as any;
  const sessionProps = {
    char, userProfile: { name: '用户' } as any, messages: [],
    peekStatus: '[normal]「横屏和竖屏的位置应该各自保存。」',
    encounterId: 'orientation-fixture', onSendMessage: async () => '',
    onReroll: async () => '', onExit: () => {}, onSettings: () => {},
    onEditMessage: () => {}, onDeleteMessage: () => {}, onDeleteMessages: async () => {},
  };
  return <OSPreviewProvider value={os}>
    {page === 'settings'
      ? <DateSettings char={char} onBack={() => { screen = 'session'; setPage('session'); }} />
      : <DateSession {...sessionProps} />}
  </OSPreviewProvider>;
}
createRoot(host).render(<Harness />);

let prepared = false;
function setRange(input: HTMLInputElement, value: string) {
  const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  native?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
function report() {
  const preview = host.querySelector<HTMLElement>('.date-settings-sprite-preview');
  const root = host.querySelector<HTMLElement>('.date-session-root');
  const spriteImg = root?.querySelector<HTMLElement>('.date-session-sprite-stage img');
  const details = [...host.querySelectorAll<HTMLDetailsElement>('details')]
    .find(el => el.querySelector('summary')?.textContent?.includes('立绘位置调整'));
  const ranges = [...(details?.querySelectorAll<HTMLInputElement>('input[type=range]') || [])];
  const slider = ranges[2]?.value ?? null;
  const orientation = preview?.dataset.spritePreviewOrientation ?? root?.dataset.spriteOrientation ?? null;
  const expectedPortrait = scenario === 'portrait' || scenario === 'settingsPortrait' || scenario === 'settingsSave' || scenario === 'settingsLegacySave';
  const expected = expectedPortrait ? 'portrait' : 'landscape';
  const cssTranslate = spriteImg?.style.transform || '';
  const y = latest.spriteConfig?.y;
  const landscapeY = latest.spriteConfigLandscape?.y;
  const previewBounds = preview?.getBoundingClientRect();
  const stageBounds = root?.getBoundingClientRect();
  const overflow = document.documentElement.scrollWidth > innerWidth + 1;
  const correctOrientation = orientation === expected;
  const expectedLayout = scenario === 'settingsSave' || scenario === 'settingsLegacySave'
    ? (y === -10 && landscapeY === 25 && updateCount > 0 && cssTranslate.includes('-10%'))
    : scenario === 'settingsLandscape'
      ? (slider === '15' && !!previewBounds && previewBounds.width > previewBounds.height)
      : scenario === 'settingsPortrait'
        ? (slider === '-10' && !!previewBounds && previewBounds.height > previewBounds.width)
        : scenario === 'legacyLandscape'
          ? cssTranslate.includes('0%, 0%')
          : scenario === 'landscape'
            ? cssTranslate.includes('10%, 15%')
            : cssTranslate.includes('0%, -10%');
  const okay = correctOrientation && expectedLayout && !overflow && errors.length === 0 && !!stageBounds;
  document.body.dataset.dateOrientationReady = String(okay);
  let el = document.getElementById('date-orientation-report');
  if (!el) { el = document.createElement('output'); el.id = 'date-orientation-report'; el.hidden = true; document.body.append(el); }
  el.textContent = JSON.stringify({
    scenario, orientation, expected, y, landscapeY, slider, cssTranslate, updateCount,
    image: spriteImg ? {
      top: Math.round(spriteImg.getBoundingClientRect().top),
      height: Math.round(spriteImg.getBoundingClientRect().height),
    } : null,
    previewAspect: previewBounds ? +(previewBounds.width / previewBounds.height).toFixed(2) : null,
    overflow, errors, okay,
  });
}
function start() {
  if (prepared) return;
  if (!host.querySelector('.date-session-root')) return setTimeout(start, 100);
  prepared = true;
  if (scenario.startsWith('settings')) {
    const details = [...host.querySelectorAll<HTMLDetailsElement>('details')]
      .find(el => el.querySelector('summary')?.textContent?.includes('立绘位置调整'));
    if (details) details.open = true;
    const landscape = host.querySelector<HTMLButtonElement>('[data-testid="date-sprite-landscape"]');
    if (scenario !== 'settingsPortrait') landscape?.click();
    if (scenario === 'settingsSave' || scenario === 'settingsLegacySave') {
      setTimeout(() => {
        const range = details?.querySelectorAll<HTMLInputElement>('input[type=range]')[2];
        if (range) setRange(range, '25');
        setTimeout(() => {
          host.querySelector<HTMLButtonElement>('button[data-testid="date-sprite-portrait"]')?.click();
          setTimeout(() => {
            host.querySelectorAll<HTMLButtonElement>('button').forEach(button => {
              if (button.textContent?.includes('保存当前布置')) button.click();
            });
            setTimeout(report, 650);
          }, 150);
        }, 200);
      }, 300);
      return;
    }
    setTimeout(() => {
      const scroll = host.querySelector<HTMLElement>('[data-testid="date-settings-scroll"]');
      if (scroll) scroll.scrollTop = 95;
      report();
    }, 600);
    return;
  }
  setTimeout(report, 650);
}
setTimeout(start, 500);
