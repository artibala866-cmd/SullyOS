/**
 * Read-only visual audit. No real messages, storage, network, or user account.
 * Each panel renders the real MessageItem with the real preset CSS.
 * ?scene=conversation|bilingual|long|media&size=320|390
 */
import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import MessageItem from '../components/chat/MessageItem';
import { PRESET_THEMES } from '../components/chat/ChatConstants';
import type { Message } from '../types';
import baseCss from '../components/chat/chatPreview.generated.css?inline';
import { QQ_BUBBLE_CSS } from '../utils/qqBubbleTheme';
import { WECHAT_BUBBLE_CSS } from '../utils/wechatBubbleTheme';
import { BLACK_WHITE_FACEBOOK_CSS } from '../utils/blackWhiteFacebookTheme';
import { BEAUTY_PREVIEW_AVATAR } from '../utils/beautyPreviewAssets';

const root = document.getElementById('bubble-matrix');
if (!root) throw new Error('No audit root');
const params = new URLSearchParams(location.search);
const scene = params.get('scene') || 'conversation';
const size = Math.min(390, Math.max(300, Number(params.get('size')) || 390));
const style = document.createElement('style');
style.textContent = [
  baseCss, QQ_BUBBLE_CSS, WECHAT_BUBBLE_CSS, BLACK_WHITE_FACEBOOK_CSS,
  '*{box-sizing:border-box} body{margin:0;background:#e9eaee;font-family:system-ui,"Noto Sans CJK SC",sans-serif}',
  '#bubble-matrix{padding:12px 0 20px;display:flex;flex-direction:column;align-items:center;gap:14px}',
  '.matrix-panel{background:#f5f5f7;border:1px solid #d6d6d8;overflow:hidden}',
  '.matrix-title{height:33px;background:#e1e2e5;border-bottom:1px solid #cfd0d3;font-size:12px;font-weight:600;padding:7px 10px;color:#353535}',
  '.matrix-chat{padding:15px 0 4px;min-height:120px}',
  '.matrix-chat .sully-chat-message {max-width:100%;}',
].join('\n');
document.head.appendChild(style);

const themes = [
  { id: 'regular', title: '普通气泡', cls: '', theme: PRESET_THEMES.default, extra: {} },
  { id: 'qq', title: 'QQ 气泡', cls: 'sully-chat-qq', theme: PRESET_THEMES.forest, extra: { qqBubble: true } },
  { id: 'wechat', title: '微信气泡', cls: 'sully-chat-wechat', theme: PRESET_THEMES.dream, extra: { wechatBubble: true, bubbleVariant: 'wechat' as const } },
  { id: 'monochrome', title: '黑白气泡', cls: 'sully-chat-monochrome', theme: PRESET_THEMES.default, extra: { blackWhiteFacebook: true } },
] as const;
type Theme = typeof themes[number];
const tm = 1790386860000;
const make = (id: number, role: Message['role'], content: string, extra: Partial<Message> = {}): Message => ({
  id, charId: 'qa-bubbles', role, type: 'text', content, timestamp: tm + id * 1200, ...extra,
});
const scenarios: Record<string, Message[]> = {
  conversation: [
    make(1, 'assistant', '你好呀。'),
    make(2, 'assistant', '我在窗边发了一会儿呆，看到外面开始下雨了。'),
    make(3, 'assistant', '要一起看吗？'),
    make(4, 'user', '可以！我也正想和你说说今天的事。'),
    make(5, 'assistant', '那你慢慢讲，我听着。', { replyTo: { id: 4, name: '我', content: '可以！我也正想和你说说今天的事。' } }),
    make(6, 'user', '嗯嗯。'),
  ],
  bilingual: [
    make(1, 'assistant', '안녕 ㅎㅎ%%BILINGUAL%%你好，哈哈。'),
    make(2, 'assistant', '오늘은 무슨 일이 있었어? 괜찮으면 천천히 얘기해줘.%%BILINGUAL%%今天发生什么事了？如果方便的话，可以慢慢告诉我。'),
    make(3, 'assistant', '너무 늦게까지 깨어 있지는 마. 내일 피곤하잖아.%%BILINGUAL%%不要熬得太晚，不然明天会很累的。'),
    make(4, 'user', '好，我知道啦！'),
    make(5, 'assistant', '그래, 잘 자.%%BILINGUAL%%好，晚安。'),
  ],
  long: [
    make(1, 'assistant', '好。'),
    make(2, 'assistant', '这是一条故意很长很长的消息，用来检查真实聊天气泡在窄屏下自动换行、内容撑高、头像位置和多条消息之间的间距会不会突然变化。这个测试不应该让任何文字跑出气泡。'),
    make(3, 'user', 'https://example.com/some/very/very/very/long/unbroken/path/that/needs/to/wrap'),
    make(4, 'assistant', '第一行：你好，今天还顺利吗？\n第二行：我看到天边有一点亮光。\n第三行：希望你也能看到。'),
    make(5, 'assistant', 'English words and 한국어와 中文混排都会影响换行。我们要看看 longwordwithoutbreaklongwordwithoutbreaklongword 能否正常折行。'),
  ],
  media: [
    make(1, 'assistant', '下面是一张图片和一段语音：'),
    make(2, 'assistant', BEAUTY_PREVIEW_AVATAR, { type: 'image' }),
    make(3, 'assistant', '<语音>你猜我现在在干嘛？</语音>'),
    make(4, 'user', '图片和文字消息交错也要保持稳定。'),
    make(5, 'assistant', '这条引用会显示完整内容，不应重叠。', { replyTo: { id: 4, name: '我', content: '图片和文字消息交错也要保持稳定。' } }),
  ],
  'broken-avatar': [
    make(1, 'assistant', '首选头像故意使用失效图片，应该回退到角色资料头像。'),
    make(2, 'user', '用户侧头像同样需要有备用图片。'),
    make(3, 'assistant', '回退失败时也要显示姓名首字，不允许出现空白头像。'),
  ],
};
const messages = scenarios[scene] || scenarios.conversation;
const auditAvatarSource = scene === 'broken-avatar' ? '/__sully_missing_avatar_primary__.png' : BEAUTY_PREVIEW_AVATAR;
const reports: Array<Record<string, unknown>> = [];
const common = (theme: Theme, msg: Message, index: number, all: Message[], avatarVisibility: 'both' | 'hide_ai' | 'hide_user' | 'hide_both' = 'both') => ({
  msg,
  activeTheme: theme.theme,
  ...theme.extra,
  charAvatar: auditAvatarSource,
  charAvatarFallback: BEAUTY_PREVIEW_AVATAR,
  userAvatar: auditAvatarSource,
  userAvatarFallback: BEAUTY_PREVIEW_AVATAR,
  avatarVisibility,
  charName: '示例角色',
  isFirstInGroup: index === 0 || all[index - 1].role !== msg.role,
  isLastInGroup: index === all.length - 1 || all[index + 1].role !== msg.role,
  // Match ChatApp's real defaults: built-in compact styles show every
  // avatar and no per-bubble clock; ordinary chat groups avatar + timestamp.
  avatarMode: (theme.id === 'regular' ? 'grouped' : 'every_message') as 'grouped' | 'every_message',
  showTimestamp: (theme.id === 'regular' ? 'always' : 'never') as 'always' | 'never',
  translationEnabled: true,
  suppressEntranceAnimation: true,
  onLongPress: (_m: Message) => {},
  onReply: (_m: Message) => {},
  selectionMode: false,
  isSelected: false,
  onToggleSelect: (_id: number) => {},
});
const view = (theme: Theme, all: Message[], avatarVisibility: 'both' | 'hide_ai' | 'hide_user' | 'hide_both' = 'both') => React.createElement('div', {className: 'sully-chat-root ' + theme.cls + ' matrix-chat'},
  ...all.map((msg, i) => React.createElement('div', {key: msg.id, 'data-qa-id': msg.id},
    React.createElement(MessageItem, common(theme, msg, i, all, avatarVisibility))
  ))
);
const audit = (section: HTMLElement, label: string) => {
  const host = section.querySelector<HTMLElement>('.matrix-chat');
  const rows = Array.from(host?.querySelectorAll<HTMLElement>('[data-qa-id]') || []);
  const bubbles = Array.from(host?.querySelectorAll<HTMLElement>('.sully-bubble-ai, .sully-bubble-user') || []);
  const messageRows = Array.from(host?.querySelectorAll<HTMLElement>('.sully-chat-message') || []);
  const aiRows = messageRows.filter(row => row.classList.contains('sully-chat-message-ai'));
  const userRows = messageRows.filter(row => row.classList.contains('sully-chat-message-user'));
  const avatarFor = (row: HTMLElement) => row.querySelector<HTMLElement>('.sully-chat-message-avatar-slot .sully-chat-avatar-wrap');
  const aiAvatars = aiRows.map(avatarFor).filter((el): el is HTMLElement => !!el);
  const userAvatars = userRows.map(avatarFor).filter((el): el is HTMLElement => !!el);
  const allAvatars = [...aiAvatars, ...userAvatars];
  const avatarSizes = allAvatars.map(el => {
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  const avatarFallbacksPresent = allAvatars.every(el => !!el.querySelector('.sully-chat-avatar-content .sully-chat-avatar-fallback'));
  const avatarSidesPresent = aiRows.length > 0 && userRows.length > 0 && aiAvatars.length > 0 && userAvatars.length > 0;
  const blackWhiteAvatarBad = label === 'monochrome' && (
    !avatarSidesPresent || !avatarFallbacksPresent
    || avatarSizes.some(size => Math.abs(size.width - 29) > 1 || Math.abs(size.height - 29) > 1)
  );
  let overlap = false;
  for(let i=1;i<rows.length;i++) {
    if(rows[i].getBoundingClientRect().top < rows[i-1].getBoundingClientRect().bottom-1) overlap = true;
  }
  const bounds=section.getBoundingClientRect();
  // The WeChat bubble's 6px tail is intentionally outside the element's
  // content box. scrollWidth on the bubble includes this pseudo-element;
  // check REAL text overflow separately so the tail isn't a false positive.
  const badBubbles = bubbles.map((el, index) => {
    const r=el.getBoundingClientRect();
    const text=el.querySelector<HTMLElement>('.sully-facebook-bubble-text');
    const badBounds=r.width < 10 || r.left < bounds.left - 2 || r.right > bounds.right + 2;
    const badText=!!text && text.scrollWidth > text.clientWidth + 3;
    return { index, badBounds, badText, width:r.width, left:r.left, right:r.right,
      textScroll:text?.scrollWidth, textClient:text?.clientWidth,
      bubbleScroll:el.scrollWidth, bubbleClient:el.clientWidth };
  }).filter(item => item.badBounds || item.badText);
  const bubbleOut = badBubbles.length > 0;
  const translations = Array.from(section.querySelectorAll<HTMLElement>('[data-bilingual-translation="true"]'));
  const translationBad=translations.some(el => {
    const bubble=el.closest('.sully-bubble-ai');
    return !bubble || !bubble.contains(el) || el.getBoundingClientRect().width < 10;
  });
  return {label, overlap, bubbleOut, badBubbles, translationBad, aiAvatars:aiAvatars.length, userAvatars:userAvatars.length,
    avatarSizes, avatarFallbacksPresent, blackWhiteAvatarBad,
    rows:rows.length, bubbles:bubbles.length, translations:translations.length,
    pass: !overlap && !bubbleOut && !translationBad && !blackWhiteAvatarBad && bubbles.length > 0};
};
for(const theme of themes) {
  const section=document.createElement('section');
  section.className='matrix-panel';
  section.dataset.auditTheme=theme.id;
  section.style.width=size+'px';
  const title=document.createElement('div');
  title.className='matrix-title'; title.textContent=theme.title+' · '+size+'px · '+scene;
  section.appendChild(title);
  const mount=document.createElement('div');
  section.appendChild(mount);
  root.appendChild(section);
  const reactRoot=createRoot(mount);
  flushSync(()=>reactRoot.render(view(theme,messages)));
  const check=audit(section,theme.id);
  reports.push(check);
}

// Real React reconciliation + memo test, not a static HTML clone:
// 1 -> 2 -> 3 same-role messages must preserve the original bubble element;
// same-ID quote/metadata/recall updates must produce the new correct surface.
for(const theme of themes) {
  const host=document.createElement('section');
  host.style.cssText='position:absolute;left:0;top:-10000px;visibility:hidden;width:'+size+'px;';
  root.appendChild(host);
  const reactRoot=createRoot(host);
  const stable=[make(10,'assistant','今天好像特别安静。'),make(11,'assistant','是啊。'),make(12,'assistant','接着说。')];
  let first:HTMLElement|null=null;
  const widths:number[]=[];
  const heights:number[]=[];
  let sameNode=true;
  for(let n=1;n<=3;n++) {
    flushSync(()=>reactRoot.render(view(theme,stable.slice(0,n))));
    const element=host.querySelector<HTMLElement>('[data-qa-id="10"] .sully-bubble-ai');
    if(!element || (first && first!==element)) sameNode=false;
    if(element){first=element;widths.push(element.getBoundingClientRect().width);heights.push(element.getBoundingClientRect().height);}
  }
  const changed=make(10,'assistant','今天好像特别安静。',{replyTo:{id:5,name:'我',content:'你在做什么？'}});
  flushSync(()=>reactRoot.render(view(theme,[changed])));
  const quote=!!host.querySelector('.sully-qq-quote, .sully-chat-reply, .sully-facebook-reply');
  const thinking=make(10,'assistant','今天好像特别安静。',{metadata:{thinkingChain:'我正在想怎么回答你。'}});
  flushSync(()=>reactRoot.render(view(theme,[thinking])));
  const thinkingChanged=!!host.querySelector('.sully-psyche-card');
  const recalled=make(10,'assistant','今天好像特别安静。',{metadata:{recalledAt:tm,recalledOriginalContent:'今天好像特别安静。'}});
  flushSync(()=>reactRoot.render(React.createElement('div',{className:'sully-chat-root '+theme.cls+' matrix-chat'},
    React.createElement(MessageItem, {...common(theme,recalled,0,[recalled]),onViewRecalled:(_m:Message)=>{}})
  )));
  const recalledChanged=!!host.querySelector('[role="status"]') && !host.querySelector('.sully-bubble-ai');
  const sides = [make(20,'assistant','角色头像应显示。'), make(21,'user','用户头像按设置隐藏。')];
  flushSync(()=>reactRoot.render(view(theme,sides,'hide_user')));
  const hideUserOK = !!host.querySelector('.sully-chat-message-ai .sully-chat-avatar-content')
    && !host.querySelector('.sully-chat-message-user .sully-chat-avatar-content');
  flushSync(()=>reactRoot.render(view(theme,sides,'hide_ai')));
  const hideAiOK = !!host.querySelector('.sully-chat-message-user .sully-chat-avatar-content')
    && !host.querySelector('.sully-chat-message-ai .sully-chat-avatar-content');
  reports.push({label:theme.id+'-dynamic',sameNode,widths,heights,quote,thinkingChanged,recalledChanged,hideUserOK,hideAiOK,
    pass:sameNode&&widths.length===3&&widths.every(w=>w>0&&Math.abs(w-widths[0])<2)
      &&heights.every(h=>Math.abs(h-heights[0])<2)&&quote&&thinkingChanged&&recalledChanged&&hideUserOK&&hideAiOK});
  flushSync(()=>reactRoot.unmount());
  host.remove();
}
// In the broken-avatar scene, primary URLs are intentionally invalid while
// the saved profile avatar remains valid. Wait for onError -> fallback-source retry.
let brokenAvatarFallbackOK = true;
if (scene === 'broken-avatar') {
  const deadline = Date.now() + 3500;
  while (Date.now() < deadline) {
    const avatarImgs = Array.from(root.querySelectorAll<HTMLImageElement>('.sully-chat-avatar-content img'));
    if (avatarImgs.length > 0 && avatarImgs.every(img => img.complete && img.naturalWidth > 0)) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const wraps = Array.from(root.querySelectorAll<HTMLElement>('.sully-chat-avatar-wrap'));
  const recoveredImages = Array.from(root.querySelectorAll<HTMLImageElement>('.sully-chat-avatar-content img'));
  brokenAvatarFallbackOK = wraps.length > 0 && wraps.every(wrap =>
    !!wrap.querySelector('.sully-chat-avatar-content .sully-chat-avatar-fallback')
  ) && recoveredImages.length === wraps.length && recoveredImages.every(img => img.complete && img.naturalWidth > 0);
  reports.push({label:'broken-avatar-fallback',wraps:wraps.length,recoveredImages:recoveredImages.length,brokenAvatarFallbackOK,pass:brokenAvatarFallbackOK});
}
const status=document.createElement('output');
status.id='matrix-report';status.hidden=true;
status.textContent=JSON.stringify({scene,size,reports,brokenAvatarFallbackOK});
root.prepend(status);
root.dataset.matrixReady=reports.every(r=>r.pass) ? 'true' : 'false';
