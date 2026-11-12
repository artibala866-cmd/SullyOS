import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryNode } from './memoryPalace/types';
import { MemoryLinkDB, MemoryNodeDB, MemoryVectorDB } from './memoryPalace/db';
import { deleteStoryVectorMemory, listStoryVectorMemories, updateStoryVectorMemory } from './storyTheaterVectorMemory';
import { storyTheaterThreadId } from './storyTheater';

const nodeAId = 'story_vector_scope_a';
const nodeBId = 'story_vector_scope_b';
const linkId = 'story_vector_scope_link';

function makeNode(id: string, entryId: string, content: string): MemoryNode {
    return {
        id,
        charId: storyTheaterThreadId(entryId),
        content,
        room: 'living_room',
        tags: ['剧情'],
        importance: 5,
        mood: 'neutral',
        embedded: true,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        accessCount: 0,
    };
}

beforeEach(async () => {
    await Promise.all([
        MemoryLinkDB.delete(linkId),
        MemoryVectorDB.delete(nodeAId),
        MemoryVectorDB.delete(nodeBId),
        MemoryNodeDB.delete(nodeAId),
        MemoryNodeDB.delete(nodeBId),
    ]);
});

describe('剧情向量管理分区隔离', () => {
    it('列表只读取当前剧情的 story-theater 分区', async () => {
        await MemoryNodeDB.save(makeNode(nodeAId, 'entry-a', 'A 的记忆'));
        await MemoryNodeDB.save(makeNode(nodeBId, 'entry-b', 'B 的记忆'));

        const rows = await listStoryVectorMemories('entry-a');
        expect(rows.map(row => row.id)).toEqual([nodeAId]);
    });

    it('拒绝跨剧情编辑与删除', async () => {
        await MemoryNodeDB.save(makeNode(nodeBId, 'entry-b', 'B 的记忆'));

        await expect(updateStoryVectorMemory('entry-a', nodeBId, '越界修改')).rejects.toThrow('跨剧情分区');
        await expect(deleteStoryVectorMemory('entry-a', nodeBId)).rejects.toThrow('跨剧情分区');
        expect((await MemoryNodeDB.getById(nodeBId))?.content).toBe('B 的记忆');
    });

    it('向量删除时模拟设备存储故障，节点、向量和跨剧情链接必须全部回滚', async () => {
        await MemoryNodeDB.save(makeNode(nodeAId, 'entry-a', '关键线索不能只删一半'));
        await MemoryNodeDB.save(makeNode(nodeBId, 'entry-b', '另一剧情保留'));
        await MemoryVectorDB.save({ memoryId: nodeAId, charId: storyTheaterThreadId('entry-a'), vector: [1, 0], dimensions: 2, model: 'test' });
        await MemoryLinkDB.save({ id: linkId, sourceId: nodeAId, targetId: nodeBId, type: 'temporal', strength: 0.5 });
        const original = IDBObjectStore.prototype.delete;
        const spy = vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['delete']>) {
            if (this.name === 'memory_vectors') throw new Error('simulated disk failure');
            return original.apply(this, args);
        });
        try {
            await expect(deleteStoryVectorMemory('entry-a', nodeAId)).rejects.toThrow('simulated disk failure');
        } finally {
            spy.mockRestore();
        }
        expect((await MemoryNodeDB.getById(nodeAId))?.content).toBe('关键线索不能只删一半');
        expect(await MemoryVectorDB.getByMemoryId(nodeAId)).toBeTruthy();
        expect(await MemoryLinkDB.getByNodeId(nodeAId)).toHaveLength(1);
        await expect(deleteStoryVectorMemory('entry-a', nodeAId)).resolves.toMatchObject({ remoteDeleted: null });
        expect(await MemoryNodeDB.getById(nodeAId)).toBeUndefined();
        expect(await MemoryVectorDB.getByMemoryId(nodeAId)).toBeUndefined();
        expect(await MemoryLinkDB.getByNodeId(nodeBId)).toEqual([]);
    });

    it('跨剧情交错删除十余条记忆，不得清掉另一段故事的节点或向量', async () => {
        const ownIds = Array.from({ length: 18 }, (_, index) => 'story_vector_chaos_a_' + index);
        const foreignIds = Array.from({ length: 18 }, (_, index) => 'story_vector_chaos_b_' + index);
        try {
            for (let i = 0; i < ownIds.length; i++) {
                await MemoryNodeDB.save(makeNode(ownIds[i], 'entry-a', 'A 第' + i + '段'));
                await MemoryNodeDB.save(makeNode(foreignIds[i], 'entry-b', 'B 第' + i + '段'));
                await MemoryVectorDB.save({ memoryId: ownIds[i], charId: storyTheaterThreadId('entry-a'), vector: [i, 1], dimensions: 2, model: 'test' });
                await MemoryVectorDB.save({ memoryId: foreignIds[i], charId: storyTheaterThreadId('entry-b'), vector: [i, 2], dimensions: 2, model: 'test' });
            }
            for (const id of ownIds.filter((_, index) => index % 2 === 0)) {
                await deleteStoryVectorMemory('entry-a', id);
            }
            const a = await listStoryVectorMemories('entry-a');
            const b = await listStoryVectorMemories('entry-b');
            expect(a.filter(node => ownIds.includes(node.id))).toHaveLength(9);
            expect(b.filter(node => foreignIds.includes(node.id))).toHaveLength(18);
            for (const id of foreignIds) expect(await MemoryVectorDB.getByMemoryId(id)).toBeDefined();
            for (const id of ownIds.filter((_, index) => index % 2 === 0)) expect(await MemoryVectorDB.getByMemoryId(id)).toBeUndefined();
        } finally {
            for (const id of [...ownIds, ...foreignIds]) {
                await MemoryVectorDB.delete(id);
                await MemoryNodeDB.delete(id);
            }
        }
    });

    it('删除当前剧情节点时同步清理本地向量与关联边，不影响其它剧情', async () => {
        await MemoryNodeDB.save(makeNode(nodeAId, 'entry-a', 'A 的记忆'));
        await MemoryNodeDB.save(makeNode(nodeBId, 'entry-b', 'B 的记忆'));
        await MemoryVectorDB.save({ memoryId: nodeAId, charId: storyTheaterThreadId('entry-a'), vector: [0.1, 0.2], dimensions: 2, model: 'test' });
        await MemoryVectorDB.save({ memoryId: nodeBId, charId: storyTheaterThreadId('entry-b'), vector: [0.3, 0.4], dimensions: 2, model: 'test' });
        await MemoryLinkDB.save({ id: linkId, sourceId: nodeAId, targetId: nodeBId, type: 'temporal', strength: 0.5 });

        await deleteStoryVectorMemory('entry-a', nodeAId);

        expect(await MemoryNodeDB.getById(nodeAId)).toBeUndefined();
        expect(await MemoryVectorDB.getByMemoryId(nodeAId)).toBeUndefined();
        expect(await MemoryLinkDB.getByNodeId(nodeAId)).toEqual([]);
        expect(await MemoryNodeDB.getById(nodeBId)).toBeTruthy();
        expect(await MemoryVectorDB.getByMemoryId(nodeBId)).toBeTruthy();
    });
});
