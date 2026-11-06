import React from 'react';
import { createRoot } from 'react-dom/client';
import { OSPreviewProvider } from '../context/OSContext';
import DateSession from '../components/date/DateSession';

const sprite = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="380" height="640" viewBox="0 0 380 640">
<ellipse cx="190" cy="595" rx="140" ry="23" fill="#000" opacity=".35"/>
<path d="M97 238 Q45 266 30 430 L0 640 H380 L350 428 Q339 266 281 238Z" fill="#262626" stroke="#5d5d60" stroke-width="5"/>
<path d="M150 206 L150 282 230 286 231 205" fill="#b9a79c"/>
<ellipse cx="190" cy="147" rx="90" ry="125" fill="#d4c1b7"/>
<path d="M96 155 Q83 27 182 22 Q286 12 290 137 L269 114 236 67 200 113 140 85 110 164Z" fill="#181b22"/>
<path d="M94 121 Q101 4 192 9 Q292 10 296 133 L279 85 246 46 217 91 173 49 121 128Z" fill="#20242d"/>
<path d="M132 154 Q151 147 170 154 M211 154 Q231 146 250 153" stroke="#292929" stroke-width="7" fill="none"/>
<path d="M165 209 Q189 224 214 207" stroke="#795a57" stroke-width="3" fill="none"/>
<path d="M136 245 Q188 300 245 243 L276 265 Q270 356 342 640 L34 640 Q106 350 106 267Z" fill="#343942"/>
<path d="M178 291 L193 470 205 291" fill="none" stroke="#777" stroke-width="8"/>
</svg>`);
const background = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="560"><rect width="1000" height="560" fill="#8b8985"/><rect y="370" width="1000" height="190" fill="#595954"/><rect x="80" y="70" width="240" height="220" fill="#bab7ab"/><rect x="700" y="70" width="200" height="260" fill="#5b514a"/><path d="M0 350 Q400 260 1000 350" fill="none" stroke="#d7d0c2" stroke-width="12"/></svg>`);
const scenario = new URLSearchParams(location.search).get('scenario') || 'dialogue';
const simulatedLandscapeKeyboard = scenario.startsWith('landscapeKeyboard');
let mockViewport: (EventTarget & { height: number; width: number; offsetTop: number; offsetLeft: number; scale: number }) | null = null;
if (simulatedLandscapeKeyboard) {
  // Match Android: the visual viewport shrinks, but CSS layout viewport stays.
  const viewport = Object.assign(new EventTarget(), {
    height: window.innerHeight, width: window.innerWidth,
    offsetTop: 0, offsetLeft: 0, scale: 1,
  });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  mockViewport = viewport;
}
const host = document.getElementById('visual')!;
// Emulate the Android visual viewport shrinking when the soft keyboard appears.
if (scenario === 'keyboard') host.style.height = `${Math.min(innerHeight, Math.max(180, Math.round(innerHeight * .58)))}px`;
const errors: string[] = [];
window.addEventListener('error', e => errors.push(e.message));
window.addEventListener('unhandledrejection', e => errors.push(String(e.reason)));

const char = {
  id: 'date-landscape-test',
  name: '周树生',
  avatar: sprite,
  sprites: { normal: sprite },
  dateBackground: background,
  spriteConfig: { scale: scenario === 'zoom' || scenario === 'landscapeKeyboardZoom' ? 2.2 : 1, x: 0, y: 0 },
  dateAppearance: { preset: 'none' },
} as any;
const props = {
  char, userProfile: { name: '玩家' }, messages: [],
  peekStatus: '[normal]「你来了。外面风挺大的，坐下来陪我聊聊吧。」',
  encounterId: 'fixture-encounter',
  onSendMessage: async () => '', onReroll: async () => '',
  onExit: () => {}, onSettings: () => {},
  onEditMessage: () => {}, onDeleteMessage: () => {}, onDeleteMessages: async () => {},
};
const os = {
  characters: [char], userProfile: { name: '玩家' }, theme: {}, apiConfig: {},
  addToast: () => {}, updateCharacter: () => {}, registerBackHandler: () => () => {},
} as any;
createRoot(host).render(<OSPreviewProvider value={os}><DateSession {...props} /></OSPreviewProvider>);

const rect = (element: Element | null) => {
  if (!element) return null;
  const r = element.getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom),
    w: Math.round(r.width), h: Math.round(r.height) };
};
const intersects = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) =>
  !!(a && b && a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y);

let prepared = false;
let originalSpriteHeight = 0;
let keyboardShown = false;
let keyboardSyncAttempts = 0;
function showSimulatedKeyboard() {
  if (!mockViewport) return;
  mockViewport.height = Math.min(105, Math.round(innerHeight * .36));
  mockViewport.dispatchEvent(new Event('resize'));
  window.dispatchEvent(new Event('resize'));
  if (!document.getElementById('mock-android-keyboard')) {
    const overlay = document.createElement('div');
    overlay.id = 'mock-android-keyboard';
    overlay.style.cssText = 'position:fixed;left:0;right:0;top:' + mockViewport.height +
      'px;bottom:0;z-index:10000;background:#e3e6ed;border-top:4px solid #bbc2d0;' +
      'display:flex;align-items:flex-start;justify-content:center;color:#4b5563;font:16px sans-serif;padding-top:20px';
    overlay.textContent = 'Android soft keyboard (simulated visual viewport)';
    document.body.append(overlay);
  }
  keyboardShown = true;
}
function hideSimulatedKeyboard() {
  if (!mockViewport) return;
  mockViewport.height = innerHeight;
  mockViewport.dispatchEvent(new Event('resize'));
  document.getElementById('mock-android-keyboard')?.remove();
  keyboardShown = false;
}
function check() {
  const stage = host.querySelector('.date-session-root');
  if (!stage) return false;
  if (!prepared) {
    prepared = true;
    originalSpriteHeight = host.querySelector('.date-session-sprite-stage img')?.getBoundingClientRect().height || 0;
    if (simulatedLandscapeKeyboard) {
      host.querySelector<HTMLButtonElement>('button[aria-label="展示输入框"]')?.click();
      setTimeout(() => {
        const textarea = host.querySelector<HTMLTextAreaElement>('.date-session-input-text');
        textarea?.focus();
        showSimulatedKeyboard();
        if (scenario === 'landscapeKeyboardRestore' || scenario === 'landscapeKeyboardMenu') {
          setTimeout(() => {
            if (scenario === 'landscapeKeyboardMenu') host.querySelector<HTMLButtonElement>('button[aria-label="打开见面菜单"]')?.click();
            hideSimulatedKeyboard();
            if (scenario === 'landscapeKeyboardRestore') textarea?.blur();
          }, 180);
        }
      }, 70);
    }
    if (scenario === 'input' || scenario === 'keyboard') host.querySelector<HTMLButtonElement>('button[aria-label="展示输入框"]')?.click();
    if (scenario === 'menu') host.querySelector<HTMLButtonElement>('button[aria-label="打开见面菜单"]')?.click();
    if (scenario === 'reading') {
      host.querySelector<HTMLButtonElement>('button[aria-label="打开见面菜单"]')?.click();
      setTimeout(() => host.querySelectorAll<HTMLButtonElement>('.date-session-menu-items button').forEach(b => {
        if (b.textContent?.includes('阅读模式')) b.click();
      }), 80);
    }
    setTimeout(check, 420);
    return true;
  }
  const smallLandscape = innerWidth >= 600 && innerWidth > innerHeight && innerHeight <= 760;
  const portrait = !smallLandscape;
  const spriteBox = rect(host.querySelector('.date-session-sprite-stage img'));
  const spriteStage = rect(host.querySelector('.date-session-sprite-stage'));
  const dialogue = rect(host.querySelector('.date-session-dialogue-card'));
  const input = rect(host.querySelector('.date-session-input-box'));
  const name = rect(host.querySelector('.date-session-dialogue-card > div:first-child'));
  const nameVisible = !!name && !!dialogue && name.y >= dialogue.y - 1 && name.bottom <= dialogue.bottom + 1;
  const controls = host.querySelector<HTMLElement>('.date-session-controls');
  const controlsRect = rect(controls);
  const reading = host.querySelector<HTMLElement>('.date-session-reading-page');
  const menu = host.querySelector<HTMLElement>('.date-session-menu-items');
  if (scenario === 'menu' && menu) menu.scrollTop = menu.scrollHeight;
  const exit = [...host.querySelectorAll<HTMLButtonElement>('.date-session-menu-items button')].find(b => b.textContent?.includes('离开'));
  const exitVisible = !!exit && !!menu && rect(exit)!.bottom <= rect(menu)!.bottom + 1 && rect(exit)!.y >= rect(menu)!.y - 1;
  const notOverflow = document.documentElement.scrollWidth <= innerWidth + 1 && document.documentElement.scrollHeight <= innerHeight + 1;
  const headVisible = !!spriteBox && spriteBox.y >= -2 && spriteBox.y < (smallLandscape ? 65 : 200);
  const spriteOnLeft = !!spriteStage && !!dialogue && spriteStage.x < dialogue.x && !intersects(spriteBox, dialogue);
  const inputCompact = !['input', 'keyboard'].includes(scenario) || (!!input && input.h <= 75 && !!dialogue && dialogue.bottom + 2 <= input.y);
  const menuFits = scenario !== 'menu' || (exitVisible && !!controlsRect && controlsRect.y >= 0 && controlsRect.bottom <= innerHeight + 1);
  const novelFits = scenario !== 'reading' || !!reading;
  const portraitFits = !!dialogue && !!spriteBox && spriteBox.y >= -2 &&
    (scenario === 'zoom' ? dialogue.bottom <= rect(host)!.bottom + 2 :
      !!input && input.w > 140 && input.x >= 0 && input.bottom <= rect(host)!.bottom + 2 &&
      dialogue.bottom + 2 <= input.y);
  const shortKeyboard = scenario === 'keyboard' && innerWidth < 600 && innerHeight <= 430;
  const compactKeyboardFits = !shortKeyboard || (
    !!spriteBox && !!dialogue && !!controlsRect && !!input &&
    spriteBox.y >= -2 && !intersects(spriteBox, dialogue) &&
    !intersects(controlsRect, dialogue) && !intersects(controlsRect, input) &&
    dialogue.bottom + 2 <= input.y
  );
  const keyboardActive = simulatedLandscapeKeyboard && keyboardShown;
  const viewportHeight = mockViewport?.height || innerHeight;
  if (keyboardActive && !stage.classList.contains('date-session-keyboard-open') && keyboardSyncAttempts++ < 12) {
    // On Chromium, virtual-time timers can advance ahead of animation frames.
    // Retry the exact viewport event and wait for the layout effect to settle.
    mockViewport?.dispatchEvent(new Event('resize'));
    setTimeout(check, 140);
    return true;
  }
  const keyboardSceneStable = !keyboardActive || (
    !!spriteBox && !!input && !!dialogue && !!controlsRect &&
    !!stage && stage.classList.contains('date-session-keyboard-open') &&
    spriteBox.h >= Math.max(100, originalSpriteHeight * .8) &&
    spriteBox.y >= -2 &&
    !intersects(controlsRect, dialogue) &&
    dialogue.bottom + 2 <= input.y &&
    input.bottom <= viewportHeight + 2 &&
    !intersects(spriteBox, dialogue) &&
    !intersects(spriteBox, input)
  );
  const keyboardRestored = scenario !== 'landscapeKeyboardRestore' ||
    (!keyboardShown && !stage.classList.contains('date-session-keyboard-open') &&
      !!spriteBox && spriteBox.h >= originalSpriteHeight * .8);
  const responsiveOk = (smallLandscape
    ? (scenario === 'reading' ? novelFits && !!controlsRect : headVisible && spriteOnLeft && inputCompact && menuFits && nameVisible)
    : (['input', 'keyboard', 'zoom'].includes(scenario) ? portraitFits : true)) && compactKeyboardFits && keyboardSceneStable && keyboardRestored;
  const report = { scenario, viewport: [innerWidth, innerHeight], smallLandscape, notOverflow,
    spriteBox, spriteStage, dialogue, input, name, nameVisible, controlsRect, exit: rect(exit || null), exitVisible, 
    headVisible, spriteOnLeft, inputCompact, menuFits, novelFits, portraitFits, compactKeyboardFits, keyboardActive, keyboardSceneStable, keyboardRestored, originalSpriteHeight, visibleHeight: viewportHeight, focusTag: document.activeElement?.tagName, rootKeyboardClass: stage.classList.contains('date-session-keyboard-open'), keyboardSyncAttempts, errors };
  const result = notOverflow && responsiveOk && errors.length === 0;
  document.body.dataset.meetLandscapeReady = String(result);
  let output = document.getElementById('meet-landscape-report');
  if (!output) { output = document.createElement('output'); output.id = 'meet-landscape-report'; output.hidden = true; document.body.append(output); }
  output.textContent = JSON.stringify(report);
  return true;
}
const begun = Date.now();
function poll() {
  if (check()) return;
  if (Date.now() - begun > 7500) {
    document.body.dataset.meetLandscapeReady = 'false';
    return;
  }
  setTimeout(poll, 80);
}
setTimeout(poll, 450);
