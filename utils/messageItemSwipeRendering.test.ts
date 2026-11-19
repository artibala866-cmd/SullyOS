// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import MessageItem from '../components/chat/MessageItem';
import type { ChatTheme, Message } from '../types';

it('only translates the bubble during a swipe and still sends the reply action', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const msg: Message = { id: 1, charId: 'role', role: 'assistant', type: 'text', content: '你好', timestamp: 1 };
    const activeTheme: ChatTheme = {
        id: 'swipe-test', name: 'Test', type: 'preset',
        user: { textColor: '#111', backgroundColor: '#eee', borderRadius: 16, opacity: 1 },
        ai: { textColor: '#111', backgroundColor: '#fff', borderRadius: 16, opacity: 1 },
    };
    const onReply = vi.fn();
    try {
        await act(async () => root.render(React.createElement(MessageItem, {
            msg, activeTheme, onReply, onLongPress: vi.fn(), onToggleSelect: vi.fn(),
            isFirstInGroup: true, isLastInGroup: true, selectionMode: false, isSelected: false,
            charAvatar: '', charName: '角色', userAvatar: '',
        })));
        const [indicator, bubble] = Array.from(host.querySelector('.sully-chat-message-content')!.children) as HTMLElement[];
        const pointer = (type: string, clientX: number) => {
            bubble.dispatchEvent(new PointerEvent(type, {
                bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: 'touch', clientX, clientY: 100,
            }));
        };
        expect(bubble.style.transform).toBe('');
        expect(indicator.style.transform).toBe('');
        await act(async () => {
            pointer('pointerdown', 160);
            pointer('pointermove', 100);
        });
        expect(bubble.style.transform).toBe('translateX(-60px)');
        expect(indicator.style.transform).toContain('scale(');
        await act(async () => pointer('pointerup', 100));
        expect(onReply.mock.calls).toEqual([[msg]]);
        expect(bubble.style.transform).toBe('');
        expect(indicator.style.transform).toBe('');
    } finally {
        await act(async () => root.unmount());
        host.remove();
        vi.unstubAllGlobals();
    }
});
