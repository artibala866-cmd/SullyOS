import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isBuiltInWechatTheme, WECHAT_BUBBLE_CSS } from './wechatBubbleTheme';

const file = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

describe('built-in WeChat private-chat bubbles', () => {
  it('does not affect custom, QQ, black/white or other themes', () => {
    expect(isBuiltInWechatTheme({ id: 'dream', name: '微信气泡' })).toBe(true);
    expect(isBuiltInWechatTheme({ id: 'default', name: '黑白气泡' })).toBe(false);
    expect(isBuiltInWechatTheme({ id: 'forest', name: 'QQ气泡' })).toBe(false);
    expect(isBuiltInWechatTheme({ id: 'custom', name: '微信气泡' })).toBe(false);
  });
  it('does not set wallpaper or change image / module message spacing', () => {
    expect(WECHAT_BUBBLE_CSS).not.toMatch(/\.sully-chat-root(?:\.sully-chat-wechat)?\s*\{/);
    expect(WECHAT_BUBBLE_CSS).not.toContain('.sully-chat-wechat .sully-chat-message {');
    expect(WECHAT_BUBBLE_CSS).toContain('.sully-wechat-text-message');
    expect(file('components/chat/MessageItem.tsx')).toContain("wechatTextMessage ? 'sully-wechat-text-message'");
  });
  it('has smaller type, content-fit widths, square edges, and two-direction tails', () => {
    expect(WECHAT_BUBBLE_CSS).toContain('font-size: 13px !important');
    expect(WECHAT_BUBBLE_CSS).toContain('max-width: min(72%');
    expect(WECHAT_BUBBLE_CSS).toContain('width: fit-content');
    expect(WECHAT_BUBBLE_CSS).toContain('border-radius: 5px !important');
    expect(WECHAT_BUBBLE_CSS).toContain('clip-path: polygon(0 0, 100% 50%, 0 100%)');
    expect(WECHAT_BUBBLE_CSS).toContain('clip-path: polygon(100% 0, 0 50%, 100% 100%)');
  });
  it('moves expanded translations into a separate card with a muted footer', () => {
    const item = file('components/chat/MessageItem.tsx');
    expect(item).toContain('showExpandedTranslation && !wechatTextMessage');
    expect(item).toContain('wechatTextMessage && !isUser && showExpandedTranslation');
    expect(item).toContain('sully-wechat-translation-card');
    expect(item).toContain('sully-wechat-translation-foot');
  });
  it('connects this preset through the existing current-character picker', () => {
    const chat = file('apps/Chat.tsx');
    expect(file('components/chat/ChatInputArea.tsx')).toContain('气泡样式 · 当前角色');
    expect(chat).toContain('onUpdateTheme={(id) => updateCharacter(char.id, { bubbleStyle: id })}');
    expect(chat).toContain('const wechatBubble = !homePhone && isBuiltInWechatTheme(activeTheme)');
    expect(chat).toContain('wechatBubble={wechatBubble}');
    expect(file('components/chat/ChatDecorationSample.tsx')).toContain('isBuiltInWechatTheme(sourceBubble)');
    expect(file('components/chat/MessageItem.tsx')).toContain('prev.wechatBubble === next.wechatBubble');
  });
});
