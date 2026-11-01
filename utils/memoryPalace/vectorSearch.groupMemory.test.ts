import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryNodeDB } from './db';
import { vectorSearch } from './vectorSearch';
import { searchVectors } from './supabaseVector';

vi.mock('./supabaseVector', () => ({
    searchVectors: vi.fn(),
}));

const config = { enabled: true, initialized: true } as any;
const remote = (memoryId: string) => ({
    memoryId, content: '在【回忆群】里发生过的事', similarity: 0.93,
    room: 'living_room', importance: 7, tags: [], mood: 'neutral',
    valence: null, arousal: null, createdAt: 1700000000000,
    lastAccessedAt: 1700000000000, accessCount: 0, pinnedUntil: null,
    sourceId: null, origin: 'extraction', archived: false,
    isSummary: false, eventBoxId: null,
});

describe('远程向量群记忆来源恢复', () => {
    beforeEach(() => vi.resetAllMocks());

    it('本地可确认群来源时，远程记忆继续保留 groupId 供后续权限判断', async () => {
        vi.mocked(searchVectors).mockResolvedValue([remote('mng_remote_1')]);
        vi.spyOn(MemoryNodeDB, 'getById').mockResolvedValue({
            id: 'mng_remote_1', charId: 'a', groupId: 'group-1', groupName: '回忆群',
        } as any);
        const result = await vectorSearch([1, 0, 0], 'a', 0.3, 10, config);
        expect(result[0].node.groupId).toBe('group-1');
        expect(result[0].node.groupName).toBe('回忆群');
    });

    it('本地来源已删除的远程群记忆不能冒充普通私人记忆', async () => {
        vi.mocked(searchVectors).mockResolvedValue([remote('mng_orphan_1')]);
        vi.spyOn(MemoryNodeDB, 'getById').mockResolvedValue(undefined);
        const result = await vectorSearch([1, 0, 0], 'a', 0.3, 10, config);
        expect(result[0].node.groupId).toBe('__unresolved_group__');
    });
});
