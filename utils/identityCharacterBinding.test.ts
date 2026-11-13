import { describe, expect, it } from 'vitest';
import { filterCharactersForIdentity } from './identityCharacterBinding';

const roster = [
    { id: 'a', name: '甲', memories: ['a-private'] },
    { id: 'b', name: '乙', memories: ['b-private'] },
    { id: 'c', name: '丙', memories: ['c-private'] },
];

describe('身份绑定角色选择器隔离', () => {
    it('未选择、空选择仍用完整原列表引用', () => {
        expect(filterCharactersForIdentity(roster)).toBe(roster);
        expect(filterCharactersForIdentity(roster, [])).toBe(roster);
    });
    it('按角色 ID 精确过滤，未绑定角色不显示且不修改原始数据', () => {
        const result = filterCharactersForIdentity(roster, ['c', 'a']);
        expect(result.map(c => c.id)).toEqual(['a', 'c']);
        expect(roster.map(c => c.id)).toEqual(['a', 'b', 'c']);
        expect(roster[1].memories).toEqual(['b-private']);
    });
    it('身份独立，未知 ID 不回退泄露其他角色', () => {
        expect(filterCharactersForIdentity(roster, ['a']).map(c => c.id)).toEqual(['a']);
        expect(filterCharactersForIdentity(roster, ['b']).map(c => c.id)).toEqual(['b']);
        expect(filterCharactersForIdentity(roster, ['deleted-id'])).toEqual([]);
    });
});
