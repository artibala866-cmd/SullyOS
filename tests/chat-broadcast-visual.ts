// Chromium smoke screenshot of the actual global ChatBroadcast React component.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import ChatBroadcast from '../components/ChatBroadcast';
import { CHAT_GEN_EVENTS, setChatViewSnapshot } from '../utils/chatGenEvents';
const root = document.getElementById('broadcast-visual')!;
const app = createRoot(root);
let opened = '';
window.addEventListener('active-msg-open', event => { opened = (event as CustomEvent).detail?.charId || ''; });
try {
  setChatViewSnapshot(false, null);
  flushSync(() => app.render(React.createElement(ChatBroadcast)));
  window.dispatchEvent(new CustomEvent(CHAT_GEN_EVENTS.replyStart, {
    detail: { charId: 'fixture-char', charName: '陈苍琛' },
  }));
  await new Promise(resolve => setTimeout(resolve, 350));
  const pill = document.querySelector<HTMLButtonElement>('.chat-broadcast-pill');
  const color = pill ? getComputedStyle(pill) : null;
  const rgb = (value: string) => (value.match(/[0-9]+(?:\\.[0-9]+)?/g) || []).slice(0, 3).map(Number);
  const neutral = (value: string) => {
    const c = rgb(value);
    return c.length === 3 && Math.max(...c) - Math.min(...c) <= 2;
  };
  const checks = {
    rendered: !!pill && pill.textContent?.includes('陈苍琛') && pill.textContent?.includes('正在回应'),
    grayscaleBackground: color && neutral(color.backgroundColor),
    grayscaleBorder: color && neutral(color.borderTopColor),
    grayText: color && neutral(color.color),
    noGreenGlow: !!pill && !/(emerald|green|rgba\\(110,\\s*220|rgba\\(140,\\s*235|linear-gradient)/i.test(pill.outerHTML),
    singleLineOnPhone: !!pill && pill.getBoundingClientRect().width < window.innerWidth - 24,
    liveDots: !!pill && pill.querySelectorAll('.chat-broadcast-dot').length === 3,
    monochromeIcon: !!pill && pill.querySelector('svg') !== null,
  };
  pill?.click();
  const clickWorks = opened === 'fixture-char';
  const result = { ...checks, clickWorks };
  const output = document.createElement('output');
  output.id = 'broadcast-visual-checks';
  output.textContent = JSON.stringify(result);
  root.appendChild(output);
  root.dataset.broadcastVisualReady = Object.values(result).every(Boolean) ? 'true' : 'false';
} catch (error) {
  root.dataset.broadcastVisualReady = 'false';
  root.dataset.broadcastVisualError = String(error);
  root.textContent = String(error);
}