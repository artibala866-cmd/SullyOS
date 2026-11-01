import { describe, expect, it } from 'vitest';
import type { GroupProfile, Message } from '../../types';
import { allowGroupMemoryInPrivate, filterPrivateGroupMemoryCandidates, filterPrivateGroupTopicCards, isPrivatePalaceSourceMessage } from './memoryScope';

const groups = [
    { id: 'allowed', name: '正常群', members: ['a'], createdAt: 1, privateChatSyncEnabled: true },
    { id: 'disabled', name: '关闭群', members: ['a'], createdAt: 1, privateChatSyncEnabled: false },
    { id: 'former', name: '退群', members: ['b'], createdAt: 1, privateChatSyncEnabled: true },
] as GroupProfile[];
const message = (id: number, groupId?: string): Message => ({
    id, charId: 'a', role: 'system', type: 'group_topic_card', content: '群摘要',
    timestamp: id, metadata: { groupTopicBox: { groupId } },
} as Message);

describe('群记忆互通权限 — 不破坏历史数据', () => {
    it('仅当前仍授权的群记忆可进入私聊，普通记忆不受影响', () => {
        expect(allowGroupMemoryInPrivate('allowed', groups)).toBe(true);
        expect(allowGroupMemoryInPrivate('disabled', groups)).toBe(false);
        expect(allowGroupMemoryInPrivate('former', groups, 'a')).toBe(false);
        expect(allowGroupMemoryInPrivate('deleted', groups)).toBe(false);
        expect(allowGroupMemoryInPrivate(undefined, groups)).toBe(true);
    });

    it('关闭互通后隐藏过去送入私聊的公共话题盒卡片，不删除数据库原卡', () => {
        const original = [message(1, 'allowed'), message(2, 'disabled'), message(3, 'deleted'), message(5, 'former'), message(6), {
            ...message(4), type: 'text', content: '私聊文字',
        } as Message];
        const result = filterPrivateGroupTopicCards(original, groups);
        expect(result.map(m => m.id)).toEqual([1, 4]);
        expect(original).toHaveLength(6);
    });

    it('群公共话题盒不再被私聊自动向量化成无 groupId 的私有记忆', () => {
        expect(isPrivatePalaceSourceMessage(message(5, 'allowed'))).toBe(false);
        expect(isPrivatePalaceSourceMessage({
            ...message(6, 'allowed'), type: 'text',
        })).toBe(true);
        expect(isPrivatePalaceSourceMessage({
            ...message(7, 'allowed'), groupId: 'allowed', type: 'text',
        })).toBe(false);
    });

    it('向量检索多种路径的结果均按群当前权限过滤', () => {
        const candidates = [
            { node: { id: 'a', groupId: 'allowed', charId: 'a' }, finalScore: 0.8 },
            { node: { id: 'b', groupId: 'disabled' }, finalScore: 0.9 },
            { node: { id: 'c', groupId: 'deleted' }, finalScore: 0.9 },
            { node: { id: 'former', groupId: 'former', charId: 'a' }, finalScore: 0.9 },
            { node: { id: 'd' }, finalScore: 0.9 },
        ];
        const result = filterPrivateGroupMemoryCandidates(candidates, groups);
        expect(result.map(x => x.node.id)).toEqual(['a', 'd']);
        expect(candidates).toHaveLength(5);
    });
});
