/**
 * Vite-only, read-only visual smoke fixture: renders actual MessageItem-based
 * ChatDecorationSample scenes, no real user DB, transfers or AI calls.
 */
import { renderChatDecorationSample } from '../components/chat/ChatDecorationSample';
import { PRESET_THEMES } from '../components/chat/ChatConstants';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import MessageItem from '../components/chat/MessageItem';
import baseChatCss from '../components/chat/chatPreview.generated.css?inline';
import { QQ_BUBBLE_CSS } from '../utils/qqBubbleTheme';
import { WECHAT_BUBBLE_CSS } from '../utils/wechatBubbleTheme';
import { BLACK_WHITE_FACEBOOK_CSS } from '../utils/blackWhiteFacebookTheme';

const root = document.getElementById('qq-visual-samples');
if (!root) throw new Error('QQ visual root missing');
const scenes = ['conversation','reply','voice-playing','transfer','image'] as const;
const sections: HTMLElement[] = [];
// Old screenshots never injected the preset CSS for their standalone bubbles.
const stylesheet = document.createElement('style');
stylesheet.textContent = [baseChatCss, QQ_BUBBLE_CSS, WECHAT_BUBBLE_CSS, BLACK_WHITE_FACEBOOK_CSS].join('\n');
document.head.appendChild(stylesheet);
try {
// Real theme flags, root CSS selectors and palette must be used together.
const bilingualStyles = [
  { name: 'regular', rootClass: '', theme: PRESET_THEMES.forest, props: {} },
  { name: 'qq', rootClass: 'sully-chat-qq', theme: PRESET_THEMES.forest, props: { qqBubble: true } },
  { name: 'wechat', rootClass: 'sully-chat-wechat', theme: PRESET_THEMES.dream, props: { wechatBubble: true, bubbleVariant: 'wechat' as const } },
  { name: 'facebook', rootClass: 'sully-chat-monochrome', theme: PRESET_THEMES.default, props: { blackWhiteFacebook: true } },
] as const;
const bilingualChecks = bilingualStyles.map(({ name, rootClass, theme, props }) => {
  const section = document.createElement('section');
  section.dataset.qqScene = 'bilingual-' + name;
  section.style.cssText = 'width:360px;max-width:100%;margin:12px auto 24px;';
  section.innerHTML = '<div class="sully-chat-root ' + rootClass + '">'
    + renderToStaticMarkup(React.createElement(MessageItem, {
      msg: { id: 9940, charId: 'bilingual-smoke', role: 'assistant' as const,
        type: 'text' as const, timestamp: Date.now(),
        content: '안녕 ㅎㅎ%%BILINGUAL%%你好（笑）' },
      activeTheme: theme, charAvatar: '/sully/head.png',
      charName: '示例角色', userAvatar: '/sully/head.png',
      isFirstInGroup: true, isLastInGroup: true, translationEnabled: true,
      onLongPress: () => {}, onReply: () => {}, selectionMode: false,
      isSelected: false, onToggleSelect: () => {}, showTimestamp: 'never', suppressEntranceAnimation: true, ...props,
    })) + '</div>';
  root.insertBefore(section, sections[0] ?? null);
  const bubble = section.querySelector<HTMLElement>('.sully-bubble-ai');
  const source = bubble?.querySelector<HTMLElement>('.sully-facebook-bubble-text > div:first-child');
  const translation = bubble?.querySelector<HTMLElement>('[data-bilingual-translation="true"]');
  const translatedBox = translation?.getBoundingClientRect();
  const sourceBox = source?.getBoundingClientRect();
  const flags = {
    name, bubble: !!bubble, source: !!source, translation: !!translation,
    sourceText: source?.textContent?.includes('안녕') === true,
    targetText: translation?.textContent?.includes('你好') === true,
    insideBubble: !!bubble && !!translation && bubble.contains(translation),
    geometry: !!sourceBox && !!translatedBox && translatedBox.top >= sourceBox.bottom - 2,
    divider: !!translation && getComputedStyle(translation).borderTopWidth !== '0px',
    overflow: !!bubble && bubble.scrollWidth <= bubble.clientWidth + 2,
    noFlip: !section.querySelector('.sully-chat-translate-action, .sully-qq-translation, .sully-wechat-translation-card'),
  };
  section.dataset.bilingualDebug = JSON.stringify(flags);
  return Object.values(flags).slice(1).every(Boolean);
});
// Four themes × three message counts: adding the second/third bubble must
// preserve the existing same-text bubble width and must not replay its fade.
const consecutiveSizing = bilingualStyles.map(({ name, rootClass, theme, props }) => {
  const section = document.createElement('section');
  section.style.cssText = 'width:360px;position:absolute;left:0;top:-100000px;visibility:hidden;';
  section.innerHTML = [1, 2, 3].map(count => {
    const rows = Array.from({ length: count }, (_unused, index) =>
      renderToStaticMarkup(React.createElement(MessageItem, {
        msg: { id: 9970 + index, charId: 'consecutive-smoke', role: 'assistant' as const,
          type: 'text' as const, timestamp: Date.now(),
          content: '안녕 ㅎㅎ%%BILINGUAL%%你好（笑）' },
        activeTheme: theme, charAvatar: '/sully/head.png',
        charName: '示例角色', userAvatar: '/sully/head.png',
        isFirstInGroup: index === 0, isLastInGroup: index === count - 1,
        translationEnabled: true, suppressEntranceAnimation: true,
        onLongPress: () => {}, onReply: () => {}, selectionMode: false,
        isSelected: false, onToggleSelect: () => {}, showTimestamp: 'never', ...props,
      }))
    ).join('');
    return '<div class="sully-chat-root ' + rootClass + '" data-consecutive-count="' + count + '">' + rows + '</div>';
  }).join('');
  root.appendChild(section);
  const widths = [1, 2, 3].map(count =>
    section.querySelector<HTMLElement>('[data-consecutive-count="' + count + '"] .sully-bubble-ai')
      ?.getBoundingClientRect().width ?? 0);
  const height = section.querySelector<HTMLElement>('.sully-bubble-ai')?.getBoundingClientRect().height ?? 0;
  const noReplay = !section.querySelector('.sully-bubble-ai.animate-fade-in');
  section.remove();
  return { name, widths, stable: widths.every(width => width > 0 && Math.abs(width - widths[0]) <= 2) && height > 15 && noReplay };
});
const consecutiveSizingOK = consecutiveSizing.every(item => item.stable);
const bilingualOK = bilingualChecks.every(Boolean);
const bilingualBreakdown = Array.from(root.querySelectorAll<HTMLElement>('[data-bilingual-debug]')).map(el => JSON.parse(el.dataset.bilingualDebug || '{}'));
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
  bilingualBreakdown,
  consecutiveSizingOK,
  consecutiveSizing,
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
