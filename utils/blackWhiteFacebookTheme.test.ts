import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BLACK_WHITE_FACEBOOK_CSS, formatBlackWhiteTime, isBlackWhiteFacebookTheme, shouldStartBlackWhiteTimeGroup } from './blackWhiteFacebookTheme';

describe('black-white private-chat Facebook-style theme', () => {
  it('only targets the built-in 黑白气泡', () => {
    expect(isBlackWhiteFacebookTheme({id:'default',name:'黑白气泡'})).toBe(true);
    expect(isBlackWhiteFacebookTheme({id:'dream',name:'微信气泡'})).toBe(false);
    expect(isBlackWhiteFacebookTheme({id:'forest',name:'QQ气泡'})).toBe(false);
    expect(isBlackWhiteFacebookTheme({id:'custom-one',name:'黑白气泡'})).toBe(false);
  });
  it('groups times over five minutes apart and across midnight', () => {
    const start = new Date(2026, 9, 25, 16, 50).getTime();
    expect(shouldStartBlackWhiteTimeGroup(undefined,start)).toBe(true);
    expect(shouldStartBlackWhiteTimeGroup(start,start+4*60000)).toBe(false);
    expect(shouldStartBlackWhiteTimeGroup(start,start+9*60000)).toBe(true);
    expect(shouldStartBlackWhiteTimeGroup(start,new Date(2026,9,26,0,1).getTime())).toBe(true);
  });
  it('uses reference screenshot time labels', () => {
    const sunday = new Date(2026,9,25,16,50).getTime();
    expect(formatBlackWhiteTime(sunday,new Date(2026,9,25,20,0).getTime())).toBe('周日 16:50');
    expect(formatBlackWhiteTime(sunday,new Date(2026,9,26,12,0).getTime())).toBe('昨天 16:50');
  });
  it('never overrides the chat wallpaper or root background', () => {
    expect(BLACK_WHITE_FACEBOOK_CSS).not.toContain('.sully-chat-root.sully-chat-monochrome {');
    expect(BLACK_WHITE_FACEBOOK_CSS).not.toContain('background: #fff !important');
    expect(BLACK_WHITE_FACEBOOK_CSS).not.toContain('background-color: #fff !important');
    expect(BLACK_WHITE_FACEBOOK_CSS).toContain('.sully-chat-monochrome .sully-bubble-user');
    expect(BLACK_WHITE_FACEBOOK_CSS).toContain('.sully-chat-monochrome .sully-bubble-ai');
  });
  it('only reflows text messages, leaving images, cards and wallpapers alone', () => {
    expect(BLACK_WHITE_FACEBOOK_CSS).toContain('.sully-facebook-text-message');
    expect(BLACK_WHITE_FACEBOOK_CSS).not.toContain('.sully-chat-monochrome .sully-chat-message {');
    const item = readFileSync(new URL('../components/chat/MessageItem.tsx', import.meta.url), 'utf8');
    const chat = readFileSync(new URL('../apps/Chat.tsx', import.meta.url), 'utf8');
    expect(item).toContain("blackWhiteFacebook && m.type === 'text' ? 'sully-facebook-text-message'");
    // Both built-in themes share this avatar layout; don't pin the test to an obsolete ternary.
    const avatarModeLine = chat.split('\n').find(line => line.includes('avatarMode={') && line.includes("m.type === 'text'")) || '';
    expect(avatarModeLine).toContain('blackWhiteFacebook');
    expect(avatarModeLine).toContain("'every_message'");
  });
  it('keeps incoming messages readable and quoted text untruncated', () => {
    expect(BLACK_WHITE_FACEBOOK_CSS).toContain('font-weight: 400 !important');
    expect(BLACK_WHITE_FACEBOOK_CSS).toContain('max-width: 76% !important');
    expect(BLACK_WHITE_FACEBOOK_CSS).toContain('white-space: pre-wrap');
    expect(BLACK_WHITE_FACEBOOK_CSS).not.toContain('text-overflow: ellipsis');
  });
  it('scopes outgoing, incoming, quote and time spacing', () => {
    expect(BLACK_WHITE_FACEBOOK_CSS).toContain('.sully-chat-monochrome .sully-facebook-reply');
    expect(BLACK_WHITE_FACEBOOK_CSS).toContain('.sully-chat-message-user');
    expect(BLACK_WHITE_FACEBOOK_CSS).toContain('.sully-chat-message-ai');
    expect(BLACK_WHITE_FACEBOOK_CSS).toContain('.sully-facebook-time');
  });
});

describe('actual current-character bubble picker wiring', () => {
  const source = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  it('connects the screenshot picker to the current character theme, not global defaults', () => {
    const picker = source('components/chat/ChatInputArea.tsx');
    const chat = source('apps/Chat.tsx');
    const presets = source('components/chat/ChatConstants.ts');
    expect(picker).toContain('气泡样式 · 当前角色');
    expect(picker).toContain('onClick={() => onUpdateTheme(t.id)}');
    expect(chat).toContain('onUpdateTheme={(id) => updateCharacter(char.id, { bubbleStyle: id })}');
    expect(chat).toContain('const blackWhiteFacebook = !homePhone && isBlackWhiteFacebookTheme(activeTheme)');
    expect(chat).toContain('blackWhiteFacebook={blackWhiteFacebook}');
    expect(presets).toContain("id: 'default', name: '黑白气泡'");
    expect(presets).toContain("backgroundColor: '#050505'");
  });
  it('keeps both reply positions outside the bubble and makes the quote wrapper a flex column', () => {
    const item = source('components/chat/MessageItem.tsx');
    expect(item).toContain('blackWhiteFacebook && isUser && m.replyTo');
    expect(item).toContain('blackWhiteFacebook && !isUser && m.replyTo');
    expect(item).toContain("blackWhiteFacebook && m.type === 'text' ? (isUser ? 'flex flex-col items-end min-w-0' : 'flex flex-col items-start min-w-0')");
    expect(item).toContain('m.replyTo && !blackWhiteFacebook');
    expect(item).toContain('prev.blackWhiteFacebook === next.blackWhiteFacebook');
  });
  it('keeps a matching preview when source bubble has the preset id', () => {
    const sample = source('components/chat/ChatDecorationSample.tsx');
    expect(sample).toContain('isBlackWhiteFacebookTheme(sourceBubble)');
    expect(sample).toContain('blackWhiteFacebook={blackWhiteFacebook}');
  });
});
