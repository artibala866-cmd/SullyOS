import { describe, expect, it } from 'vitest';
import type { CharacterProfile } from '../../types';
import { groupMemberContextForSync } from './memberMemoryScope';

const character = {
    id: 'a', name: '角色A', description: '冷静', systemPrompt: '有独立性格', worldview: '现代',
    memories: [{ id: 'private-memory', date: '2026-11-01', summary: '两人的私事' }],
    refinedMemories: { core: '私聊核心记忆' },
    activeMemoryMonths: ['2026-11'],
    impression: { private: '对用户的私密印象' },
    selfInsights: ['私人反思'],
    memoryPalaceEnabled: true,
    memoryPalaceInjection: '私聊向量召回',
    roomPlatesInjection: '私聊门牌',
} as unknown as CharacterProfile;

describe('群聊关闭私聊互通时遮蔽私人记忆', () => {
    it('互通开启时保留同一角色和原有记忆', () => {
        expect(groupMemberContextForSync(character, true)).toBe(character);
    });

    it('关闭后只生成无私人记忆的临时副本，不篡改角色人设/原数据', () => {
        const scope = groupMemberContextForSync(character, false);
        expect(scope).not.toBe(character);
        expect(scope.name).toBe(character.name);
        expect(scope.systemPrompt).toBe(character.systemPrompt);
        expect(scope.worldview).toBe(character.worldview);
        expect(scope.memories).toEqual([]);
        expect(scope.refinedMemories).toEqual({});
        expect(scope.impression).toBeUndefined();
        expect(scope.selfInsights).toEqual([]);
        expect(scope.memoryPalaceEnabled).toBe(false);
        expect(scope.memoryPalaceInjection).toBe('');
        expect(scope.roomPlatesInjection).toBe('');
        expect(character.memories).toHaveLength(1);
        expect(character.memoryPalaceInjection).toBe('私聊向量召回');
    });
});
