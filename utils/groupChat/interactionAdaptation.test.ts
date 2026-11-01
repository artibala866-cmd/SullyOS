import { describe, expect, it } from 'vitest';
import type { CharacterAccommodationPolicy, Message } from '../../types';
import { buildGroupMemberInteractionGuidance } from './interactionAdaptation';

const user = (id: number, content: string, type: Message['type'] = 'text'): Message => ({
    id, charId: 'user', groupId: 'group-1', role: 'user', type,
    content, timestamp: id * 1000,
} as Message);
const member = (id: number, content: string): Message => ({
    id, charId: 'member-2', groupId: 'group-1', role: 'assistant', type: 'text',
    content, timestamp: id * 1000,
} as Message);
const followsLength: CharacterAccommodationPolicy = {
    length: 1, rhythm: 0, energy: 0, punctuation: 0, emoji: 0,
};
const followsNothing: CharacterAccommodationPolicy = {
    length: 0, rhythm: 0, energy: 0, punctuation: 0, emoji: 0,
};

describe('group interaction adaptation', () => {
    it('群聊能按成员自己的五维参数生成指令，0% 的成员不受影响', () => {
        const history = [user(1, '好呀')];
        const guide = buildGroupMemberInteractionGuidance(history, '小夏', followsLength, '用户');
        expect(guide).toContain('仅适用于 小夏');
        expect(guide).toContain('回应可以比你平时稍短一些');
        expect(buildGroupMemberInteractionGuidance(history, '阿青', followsNothing, '用户')).toBe('');
    });

    it('群中其他角色发言不被算作用户风格，轮询模式后续角色仍可回应最近用户', () => {
        const history = [
            member(1, '我有很多很多话要说。'.repeat(70)),
            user(2, '嗯'),
            member(3, '这个话题我再说多一点。'.repeat(70)),
        ];
        const guide = buildGroupMemberInteractionGuidance(history, '阿青', followsLength);
        expect(guide).toContain('回应可以比你平时稍短一些');
        expect(guide).not.toContain('我有很多很多话要说');
    });

    it('最近没有用户发言，或群友消息已冲走最新用户时，不持续模仿旧习惯', () => {
        expect(buildGroupMemberInteractionGuidance([member(1, '群友自言自语')], '小夏', followsLength)).toBe('');
        const stale = [user(1, '嗯'), ...Array.from({ length: 41 }, (_, index) => member(index + 2, '群里自己聊'))];
        expect(buildGroupMemberInteractionGuidance(stale, '小夏', followsLength)).toBe('');
    });

    it('最新用户发图片/表情时，不将媒体地址或旧用户语气当成当前语气', () => {
        for (const type of ['image', 'emoji'] as const) {
            const history = [user(1, '嗯'), member(2, '回复'), user(3, 'data:image/jpeg;base64,AAA', type)];
            expect(buildGroupMemberInteractionGuidance(history, '小夏', followsLength)).toBe('');
        }
    });

    it('群里用户连发消息形成同一轮，别的群成员会切开用户轮次', () => {
        const noBoundary = [user(1, '哎'), user(2, '哈哈')];
        const withBoundary = [user(1, '哎'), member(2, '在'), user(3, '哈哈')];
        const first = buildGroupMemberInteractionGuidance(noBoundary, '小夏', followsLength);
        const second = buildGroupMemberInteractionGuidance(withBoundary, '小夏', followsLength);
        expect(first).toContain('此刻的交流节奏');
        expect(second).toContain('此刻的交流节奏');
    });
});
