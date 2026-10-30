import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { formatQQTime, isBuiltInQQTheme, QQ_BUBBLE_CSS, shouldStartQQTimeGroup } from './qqBubbleTheme';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

describe('built-in QQ bubble visual layout', () => {
  it('only identifies the current-character built-in QQ preset', () => {
    expect(isBuiltInQQTheme({id:'forest',name:'QQ气泡'})).toBe(true);
    expect(isBuiltInQQTheme({id:'default',name:'黑白气泡'})).toBe(false);
    expect(isBuiltInQQTheme({id:'dream',name:'微信气泡'})).toBe(false);
    expect(isBuiltInQQTheme({id:'custom',name:'QQ气泡'})).toBe(false);
    expect(isBuiltInQQTheme(undefined)).toBe(false);
  });
  it('groups time labels and preserves date context', () => {
    const t = new Date(2026,9,30,1,50).getTime();
    expect(shouldStartQQTimeGroup(undefined,t)).toBe(true);
    expect(shouldStartQQTimeGroup(t,t+9*60000)).toBe(false);
    expect(shouldStartQQTimeGroup(t,t+10*60000)).toBe(true);
    expect(shouldStartQQTimeGroup(t,new Date(2026,9,31,0,1).getTime())).toBe(true);
    expect(formatQQTime(t,t)).toBe('01:50');
    expect(formatQQTime(t,new Date(2026,9,31,2).getTime())).toBe('昨天 01:50');
  });
  it('uses small blue and white bubbles while preserving wallpaper and non-text cards', () => {
    expect(QQ_BUBBLE_CSS).toContain('font-size: 13px !important');
    expect(QQ_BUBBLE_CSS).toContain('border-radius: 12px !important');
    expect(QQ_BUBBLE_CSS).toContain('background: #159eff !important');
    expect(QQ_BUBBLE_CSS).toContain('background: #fff !important');
    expect(QQ_BUBBLE_CSS).toContain('width: 30px !important');
    expect(QQ_BUBBLE_CSS).toContain('max-width: min(68%');
    expect(QQ_BUBBLE_CSS).toContain('max-width: min(74%');
    expect(QQ_BUBBLE_CSS).not.toContain('.sully-chat-root.sully-chat-qq {');
    expect(QQ_BUBBLE_CSS).not.toContain('.sully-chat-qq .sully-chat-message {');
    expect(QQ_BUBBLE_CSS).toContain('.sully-qq-text-message');
  });
  it('renders a two-line-style inset quote without cutting to 10 characters', () => {
    const item = read('components/chat/MessageItem.tsx');
    expect(item).toContain('qqTextMessage && m.replyTo');
    expect(item).toContain('sully-qq-quote-name');
    expect(item).toContain('sully-qq-quote-content');
    expect(item).toContain('m.replyTo && !blackWhiteFacebook && !qqTextMessage');
    expect(QQ_BUBBLE_CSS).toContain('white-space: pre-wrap');
    expect(QQ_BUBBLE_CSS).toContain('.sully-qq-quote-arrow');
  });
  it('wires QQ through the existing picker, live/streamed messages and preview', () => {
    const chat=read('apps/Chat.tsx');
    const preview=read('components/chat/ChatDecorationSample.tsx');
    expect(read('components/chat/ChatInputArea.tsx')).toContain('气泡样式 · 当前角色');
    expect(chat).toContain('onUpdateTheme={(id) => updateCharacter(char.id, { bubbleStyle: id })}');
    expect(chat).toContain('const qqBubble = !homePhone && isBuiltInQQTheme(activeTheme)');
    expect(chat).toContain('qqBubble={qqBubble}');
    expect(chat).toContain('shouldStartQQTimeGroup(prevMessage?.timestamp, m.timestamp)');
    expect(preview).toContain('isBuiltInQQTheme(sourceBubble)');
    expect(preview).toContain('qqBubble={qqBubble}');
    expect(read('components/chat/MessageItem.tsx')).toContain('prev.qqBubble === next.qqBubble');
  });
});
