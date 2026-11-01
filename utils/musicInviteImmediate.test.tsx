// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import MusicInviteReplyBridge from '../components/music/MusicInviteReplyBridge';

const state = vi.hoisted(() => ({
    generated: vi.fn(async (..._args: unknown[]) => {}),
    history: [] as any[],
    blocked: false,
    busy: false,
    configured: true,
}));
vi.mock('../context/OSContext', () => ({
    useOS: () => ({
        characters: [{ id: 'music-char', name: '阿沐', chatBlock: {} }],
        userProfile: { name: 'User' },
        apiConfig: { baseUrl: 'https://example.com', model: 'test-model' },
        groups: [], realtimeConfig: {}, memoryPalaceConfig: {},
        addToast: vi.fn(), showError: vi.fn(), updateCharacter: vi.fn(), updateUserProfile: vi.fn(),
    }),
}));
vi.mock('../hooks/useChatAI', () => ({
    useChatAI: () => ({ triggerAI: state.generated }),
}));
vi.mock('../utils/db', () => ({
    DB: {
        getEmojis: vi.fn(async () => []),
        getEmojiCategories: vi.fn(async () => []),
        getMessagesByCharId: vi.fn(async () => state.history),
    },
}));
vi.mock('../utils/chatPrompts', () => ({
    ChatPrompts: { filterVisibleEmojis: () => ({ emojis: [], categories: [] }) },
}));
vi.mock('../utils/chatReplyLock', () => ({
    isChatReplyActive: () => state.busy,
}));
vi.mock('../utils/chatBlock', () => ({
    isPrivateChatBlocked: () => state.blocked,
}));
vi.mock('../utils/characterApi', () => ({
    resolveDialogueApi: () => state.configured
        ? { baseUrl: 'https://example.com', model: 'test-model', apiKey: '' }
        : { baseUrl: '', model: '', apiKey: '' },
}));

let root: Root;
let host: HTMLDivElement;
const invite = (id = 73) => ({
    id, charId: 'music-char', role: 'user', type: 'system',
    content: '[一起听邀请] 我邀请你一起听音乐。',
    metadata: { musicListenInvite: true, invitedAt: Date.now(), status: 'pending' },
});
const flush = async () => {
    // React effects + async IDB validation + cross-tab lock continuation.
    await act(async () => {
        for (let i = 0; i < 8; i++) await Promise.resolve();
    });
};
const emit = (messageId = 73) => {
    window.dispatchEvent(new CustomEvent('music-listen-invite-created', {
        detail: { charId: 'music-char', messageId },
    }));
};
beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    state.generated.mockReset();
    state.generated.mockResolvedValue(undefined);
    state.history = [];
    state.blocked = false;
    state.busy = false;
    state.configured = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => { root.render(<MusicInviteReplyBridge />); });
    await flush();
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    localStorage.clear();
});

describe('一起听即时回应与真人感/主动消息隔离', () => {
    it('不需要打开私聊、不需要自动回复或主动消息，就会走原私聊 AI 的本地即时动作路由', async () => {
        state.history = [invite()];
        await act(async () => { emit(); emit(); });
        await flush();
        expect(state.generated).toHaveBeenCalledTimes(1);
        expect(state.generated.mock.calls[0][0]).toEqual(state.history);
        expect(state.generated.mock.calls[0][2]).toEqual({ immediateMusicInvite: true });
    });

    it('主动消息恰好先送达，不能抢走待回应的音乐邀请', async () => {
        state.history = [invite(), {
            id: 74, charId: 'music-char', role: 'assistant', type: 'text',
            content: '刚刚想到一件事',
            metadata: { activeMsg2: { taskId: 'autowake:day' } },
        }];
        await act(async () => emit());
        await flush();
        expect(state.generated).toHaveBeenCalledTimes(1);
        expect(state.generated.mock.calls[0][2]).toEqual({ immediateMusicInvite: true });
    });

    it('用户已撤回或拒绝的邀请不触发新消息', async () => {
        state.history = [invite(), {
            id: 74, role: 'user', type: 'system', content: '撤回',
            metadata: { musicListenInviteResponseTo: 73, cancelled: true },
        }];
        await act(async () => emit());
        await flush();
        expect(state.generated).not.toHaveBeenCalled();
    });

    it('后来发送的普通文本优先，不能把邀请延迟回复变成对新消息的插嘴', async () => {
        state.history = [invite(), { id: 74, role: 'user', type: 'text', content: '等一下' }];
        await act(async () => emit());
        await flush();
        expect(state.generated).not.toHaveBeenCalled();
    });

    it('角色拉黑或未配置 API 时不会借音乐事件越权生成', async () => {
        state.history = [invite()];
        state.blocked = true;
        await act(async () => emit());
        await flush();
        expect(state.generated).not.toHaveBeenCalled();
    });

    it('已回应的同一邀请不会因为重复通知或另一标签刷新再次消费', async () => {
        state.history = [invite()];
        await act(async () => emit());
        await flush();
        await act(async () => emit());
        await flush();
        expect(state.generated).toHaveBeenCalledTimes(1);
    });
});
