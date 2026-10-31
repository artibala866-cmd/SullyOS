/**
 * Vite-only, read-only visual smoke fixture: renders actual MessageItem-based
 * ChatDecorationSample scenes, no real user DB, transfers or AI calls.
 */
import { renderChatDecorationSample } from '../components/chat/ChatDecorationSample';
import { PRESET_THEMES } from '../components/chat/ChatConstants';
import '../index.css';

const root = document.getElementById('qq-visual-samples');
if (!root) throw new Error('QQ visual root missing');
const scenes = ['conversation','reply','voice-playing','transfer','image'] as const;
const sections: HTMLElement[] = [];
for (const scene of scenes) {
  const { markup, css } = renderChatDecorationSample(
    { parts: { bubbles: PRESET_THEMES.forest } },
    scene
  );
  const container = document.createElement('section');
  container.dataset.qqScene = scene;
  container.style.cssText = 'position:relative;width:360px;max-width:100%;margin:12px auto 24px;overflow:hidden;';
  container.innerHTML = '<div class="beauty-preview-body">' + markup + '</div>';
  const style = document.createElement('style');
  style.textContent = css;
  container.prepend(style);
  root.appendChild(container);
  sections.push(container);
}
const has = (selector: string) => !!root.querySelector(selector);
const checks = {
  text: has('.sully-qq-text-message .sully-qq-bubble-text'),
  quoted: has('.sully-qq-quote'),
  transfer: has('.sully-qq-transfer-message .sully-chat-transfer-card'),
  image: has('.sully-qq-image-message .chat-image-thumbnail'),
  scoped: sections.every(section => !!section.querySelector('.sully-chat-qq')),
};
const status = document.createElement('output');
status.id = 'qq-visual-smoke';
status.textContent = JSON.stringify(checks);
root.prepend(status);
root.dataset.qqRendered = Object.values(checks).every(Boolean) ? 'true' : 'false';
