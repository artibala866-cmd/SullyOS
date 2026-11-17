/**
 * Vite-only, read-only visual smoke fixture: renders actual MessageItem-based
 * ChatDecorationSample scenes, no real user DB, transfers or AI calls.
 */
import { renderChatDecorationSample } from '../components/chat/ChatDecorationSample';
import { PRESET_THEMES } from '../components/chat/ChatConstants';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import MessageItem from '../components/chat/MessageItem';

const root = document.getElementById('qq-visual-samples');
if (!root) throw new Error('QQ visual root missing');
const scenes = ['conversation','reply','voice-playing','transfer','image'] as const;
const sections: HTMLElement[] = [];
try {
for (const scene of scenes) {
  const { markup, css } = renderChatDecorationSample(
    { format: 'sullyos-chat-decoration', version: 1, name: 'QQ浏览器视觉测试', parts: { bubbles: PRESET_THEMES.forest } },
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
// Validate a real quoted MessageItem: the legacy bilingual preview may be blank.
const example = {
 id: 9931,charId:'qq-smoke',role:'assistant' as const,type:'text' as const,
 timestamp:Date.now(),content:'这个引用会保持完整，不能截断。',
 replyTo:{id:9930,name:'桂鱼',content:'我发的参考消息内容很长，引用必须完整显示并自动换行。'}
};
const quoteSection=document.createElement('section');
quoteSection.dataset.qqScene='real-quote';
quoteSection.style.cssText='width:360px;max-width:100%;margin:12px auto 24px;';
quoteSection.innerHTML='<div class="sully-chat-root sully-chat-qq">'+renderToStaticMarkup(
 React.createElement(MessageItem,{
  msg:example,qqBubble:true,activeTheme:PRESET_THEMES.forest,
  isFirstInGroup:true,isLastInGroup:true,charAvatar:'/sully/head.png',
  charName:'示例角色',userAvatar:'/sully/head.png',
  onLongPress:()=>{},onReply:()=>{},selectionMode:false,isSelected:false,
  onToggleSelect:()=>{},showTimestamp:'never'
 })
)+'</div>';
root.appendChild(quoteSection);
// Verify all private-chat bubble skins with the actual MessageItem renderer.
const bilingualStyles = [
  { name: 'regular', props: {} },
  { name: 'qq', props: { qqBubble: true } },
  { name: 'wechat', props: { wechatBubble: true, bubbleVariant: 'wechat' as const } },
  { name: 'facebook', props: { blackWhiteFacebook: true } },
] as const;
const bilingualChecks = bilingualStyles.map(({ name, props }) => {
  const section = document.createElement('section');
  section.dataset.qqScene = 'bilingual-' + name;
  section.style.cssText = 'width:360px;max-width:100%;margin:12px auto 24px;';
  section.innerHTML = '<div class="sully-chat-root ' + (name === 'qq' ? 'sully-chat-qq' : '') + '">'
    + renderToStaticMarkup(React.createElement(MessageItem, {
      msg: { id: 9940, charId: 'bilingual-smoke', role: 'assistant' as const,
        type: 'text' as const, timestamp: Date.now(),
        content: '안녕 ㅎㅎ%%BILINGUAL%%你好（笑）' },
      activeTheme: PRESET_THEMES.forest, charAvatar: '/sully/head.png',
      charName: '示例角色', userAvatar: '/sully/head.png',
      isFirstInGroup: true, isLastInGroup: true, translationEnabled: true,
      onLongPress: () => {}, onReply: () => {}, selectionMode: false,
      isSelected: false, onToggleSelect: () => {}, showTimestamp: 'never', ...props,
    })) + '</div>';
  root.appendChild(section);
  const bubble = section.querySelector<HTMLElement>('.sully-bubble-ai');
  const source = bubble?.querySelector<HTMLElement>('.sully-facebook-bubble-text > div:first-child');
  const translation = bubble?.querySelector<HTMLElement>('[data-bilingual-translation="true"]');
  const translatedBox = translation?.getBoundingClientRect();
  const sourceBox = source?.getBoundingClientRect();
  return !!bubble && !!source && !!translation && !!sourceBox && !!translatedBox
    && source.textContent?.includes('안녕') === true
    && translation.textContent?.includes('你好') === true
    && translatedBox.top >= sourceBox.bottom - 2
    && getComputedStyle(translation).borderTopWidth !== '0px'
    && bubble.scrollWidth <= bubble.clientWidth + 2
    && !section.querySelector('.sully-chat-translate-action, .sully-qq-translation, .sully-wechat-translation-card');
});
const bilingualOK = bilingualChecks.every(Boolean);
// Real Chromium geometry is checked, not only DOM existence, before screenshot approval.
const transferCard = root.querySelector<HTMLElement>('[data-qq-scene="transfer"] .sully-chat-transfer-card');
const transferBox = transferCard?.getBoundingClientRect();
const transferGeometryOK = !!transferBox && transferBox.width > 215 && transferBox.width <= 241
  && transferBox.height >= 93 && transferBox.height <= 96;
const quoteCard = root.querySelector<HTMLElement>('[data-qq-scene="real-quote"] .sully-qq-quote');
const quoteContent = root.querySelector<HTMLElement>('[data-qq-scene="real-quote"] .sully-qq-quote-content');
const quoteVisible = !!quoteCard && !!quoteContent
  && quoteContent.scrollHeight <= quoteContent.clientHeight + 2
  && quoteContent.textContent?.includes('完整显示') === true;
const has = (selector: string) => !!root.querySelector(selector);
const checks = {
  text: has('.sully-qq-text-message .sully-qq-bubble-text'),
  quoted: has('.sully-qq-quote'),
  transfer: has('.sully-qq-transfer-message .sully-chat-transfer-card'),
  transferGeometryOK,
  quoteVisible,
  bilingualOK,
  image: has('.sully-qq-image-message .chat-image-thumbnail'),
  scoped: sections.every(section => !!section.querySelector('.sully-chat-qq')),
};
const status = document.createElement('output');
status.id = 'qq-visual-smoke';
status.hidden = true;
status.textContent = JSON.stringify(checks);
root.prepend(status);
root.dataset.qqRendered = Object.values(checks).every(Boolean) ? 'true' : 'false';
} catch (error) {
  root.dataset.qqRendered = 'false';
  root.dataset.qqError = error instanceof Error ? error.stack || error.message : String(error);
  root.textContent = String(error);
}
