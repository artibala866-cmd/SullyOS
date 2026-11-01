import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfile, GroupProfile, Message } from '../../types';
import { DB } from '../db';
import { MemoryNodeDB } from './db';
import { getEmbeddings } from './embedding';
import { upsertVector } from './supabaseVector';
import { extractGroupMemoriesFromBuffer } from './groupExtraction';
import { deleteGroupMemoriesByGroupId, getGroupMemoryPalaceHighWaterMark, processGroupNewMessages } from './groupPipeline';

vi.mock('./embedding', async (importOriginal) => {
    const original = await importOriginal<typeof import('./embedding')>();
    return { ...original, getEmbeddings: vi.fn(async (texts: string[]) => texts.map(() => new Float32Array([1, 0, 0]))) };
});
vi.mock('./supabaseVector', () => ({
    upsertVector: vi.fn(async () => true),
    deleteVector: vi.fn(async () => true),
}));
vi.mock('./groupExtraction', () => ({
    extractGroupMemoriesFromBuffer: vi.fn(async () => ({
        drafts: [{
            content: '在【测试群】里，大家讨论了周末学习安排。',
            room: 'study',
            tags: ['学习'],
            importance: 6,
            mood: 'peaceful',
            createdAt: 1700000000000,
        }],
    })),
}));

let counter = 0;
const makeGroup = async (sync = true) => {
    const id = 'group-memory-integration-' + (++counter);
    const a = { id: id + '-a', name: 'A', memoryPalaceEnabled: true, memories: [] } as unknown as CharacterProfile;
    const b = { id: id + '-b', name: 'B', memoryPalaceEnabled: true, memories: [] } as unknown as CharacterProfile;
    const group: GroupProfile = { id, name: '测试群', members: [a.id, b.id], createdAt: Date.now(), privateChatSyncEnabled: sync };
    await Promise.all([DB.saveGroup(group), DB.saveCharacter(a), DB.saveCharacter(b)]);
    return { group, a, b };
};
const messagesFor = (groupId: string, count = 510): Message[] =>
    Array.from({ length: count }, (_, i) => ({
        id: i + 1, groupId, charId: i % 2 === 0 ? 'user' : 'member',
        role: i % 2 === 0 ? 'user' : 'assistant', type: 'text',
        content: '群聊重要话题' + i, timestamp: 1700000000000 + i * 1000,
    } as Message));

describe('群聊与个人记忆宫殿双向归档', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        localStorage.clear();
        vi.clearAllMocks();
        vi.mocked(upsertVector).mockResolvedValue(true);
        localStorage.setItem('os_memory_palace_config', JSON.stringify({
            lightLLM: { baseUrl: 'https://example.invalid/v1', apiKey: 'test', model: 'test' },
            embedding: { baseUrl: 'https://example.invalid/v1', apiKey: 'test', model: 'test', dimensions: 3 },
        }));
        vi.mocked(getEmbeddings).mockImplementation(async texts => texts.map(() => new Float32Array([1, 0, 0])));
        vi.mocked(extractGroupMemoriesFromBuffer).mockImplementation(async () => ({
            drafts: [{
                content: '在【测试群】里，大家讨论了周末学习安排。',
                room: 'study',
                tags: ['学习'],
                importance: 6,
                mood: 'peaceful',
                createdAt: 1700000000000,
            }],
        }));
    });

    it('超过缓冲阈值后按成员分别原子存储，私聊可按 charId 检索对应群记忆', async () => {
        const { group, a, b } = await makeGroup();
        vi.spyOn(DB, 'getGroupMessages').mockResolvedValueOnce(messagesFor(group.id));
        const result = await processGroupNewMessages(group, [a, b], '用户');
        expect(result?.stored).toBe(2);
        expect(getGroupMemoryPalaceHighWaterMark(group.id)).toBeGreaterThan(0);
        const nodesA = (await MemoryNodeDB.getByCharId(a.id)).filter(n => n.groupId === group.id);
        const nodesB = (await MemoryNodeDB.getByCharId(b.id)).filter(n => n.groupId === group.id);
        expect(nodesA).toHaveLength(1);
        expect(nodesB).toHaveLength(1);
        expect(nodesA[0].charId).toBe(a.id);
        expect(nodesB[0].charId).toBe(b.id);
    });

    it('部分成员 embedding 失败不推进群游标，恢复后去重补写而不重复 A 的记忆', async () => {
        const { group, a, b } = await makeGroup();
        vi.spyOn(DB, 'getGroupMessages').mockResolvedValue(messagesFor(group.id));
        let failB = true;
        vi.mocked(getEmbeddings).mockImplementation(async (_texts, config) => {
            if (failB && (config as any).model === 'broken') throw Error('embedding unavailable');
            return [new Float32Array([1, 0, 0])];
        });
        b.embeddingConfig = { baseUrl: 'https://example.invalid', apiKey: 'test', model: 'broken', dimensions: 3 };
        await DB.saveCharacter(b);
        const partial = await processGroupNewMessages(group, [a, b], '用户');
        expect(partial?.stored).toBe(1);
        expect(getGroupMemoryPalaceHighWaterMark(group.id)).toBe(0);
        failB = false;
        const retried = await processGroupNewMessages(group, [a, b], '用户');
        expect(retried?.stored).toBe(1);
        expect(getGroupMemoryPalaceHighWaterMark(group.id)).toBeGreaterThan(0);
        expect((await MemoryNodeDB.getByCharId(a.id)).filter(n => n.groupId === group.id)).toHaveLength(1);
        expect((await MemoryNodeDB.getByCharId(b.id)).filter(n => n.groupId === group.id)).toHaveLength(1);
    });

    it('远端同步失败保留水位，下次对本地相同记忆补传云端而不重复存储', async () => {
        const { group, a, b } = await makeGroup();
        vi.spyOn(DB, 'getGroupMessages').mockResolvedValue(messagesFor(group.id));
        localStorage.setItem('os_remote_vector_config', JSON.stringify({
            enabled: true, initialized: true, baseUrl: 'https://example.invalid',
            apiKey: 'test', tableName: 'memory_vectors',
        }));
        let firstUpload = true;
        vi.mocked(upsertVector).mockImplementation(async () => {
            if (firstUpload) { firstUpload = false; return false; }
            return true;
        });
        const first = await processGroupNewMessages(group, [a, b], '用户');
        expect(first?.stored).toBe(2);
        expect(getGroupMemoryPalaceHighWaterMark(group.id)).toBe(0);
        const retried = await processGroupNewMessages(group, [a, b], '用户');
        expect(retried?.stored).toBe(0);
        expect(getGroupMemoryPalaceHighWaterMark(group.id)).toBeGreaterThan(0);
        expect(vi.mocked(upsertVector).mock.calls.length).toBeGreaterThanOrEqual(3);
        expect((await MemoryNodeDB.getByCharId(a.id)).filter(n => n.groupId === group.id)).toHaveLength(1);
    });

    it('旧群已有共享进度时，新成员仍能补录旧群记忆而不让老成员重复写入', async () => {
        const { group, a, b } = await makeGroup();
        vi.spyOn(DB, 'getGroupMessages').mockResolvedValue(messagesFor(group.id));
        const initial = await processGroupNewMessages(group, [a, b], '用户');
        expect(initial?.stored).toBe(2);
        const originalCursor = getGroupMemoryPalaceHighWaterMark(group.id);
        const newcomer = { ...a, id: group.id + '-newcomer', name: '新成员' } as CharacterProfile;
        await DB.saveCharacter(newcomer);
        const updated = { ...group, members: [...group.members, newcomer.id] };
        await DB.saveGroup(updated);
        const replay = await processGroupNewMessages(updated, [a, b, newcomer], '用户');
        expect(replay?.stored).toBe(1);
        expect((await MemoryNodeDB.getByCharId(newcomer.id)).filter(n => n.groupId === group.id)).toHaveLength(1);
        expect((await MemoryNodeDB.getByCharId(a.id)).filter(n => n.groupId === group.id)).toHaveLength(1);
        expect(getGroupMemoryPalaceHighWaterMark(group.id)).toBe(originalCursor);
    });

    it('旧共享游标补录必须包含最后不足200条的尾巴，且不回退老水位', async () => {
        const { group, a, b } = await makeGroup();
        vi.spyOn(DB, 'getGroupMessages').mockResolvedValue(messagesFor(group.id));
        localStorage.setItem('mp_lastMsgId_group_' + group.id, '209');
        const first = await processGroupNewMessages(group, [a, b], '用户');
        expect(first?.progressed).toBe(true);
        expect(first?.processedMessageCount).toBe(200);
        expect(getGroupMemoryPalaceHighWaterMark(group.id)).toBe(209);
        const tail = await processGroupNewMessages(group, [a, b], '用户');
        expect(tail?.progressed).toBe(true);
        expect(tail?.processedMessageCount).toBe(9);
        expect(localStorage.getItem('mp_lastMsgId_group_member_' + group.id + '_' + a.id)).toBe('209');
        expect(localStorage.getItem('mp_lastMsgId_group_member_' + group.id + '_' + b.id)).toBe('209');
        expect((await MemoryNodeDB.getByCharId(a.id)).filter(n => n.groupId === group.id)).toHaveLength(1);
    });

    it('不同群中内容相似也必须各自有可追溯记忆，不能跨群误去重', async () => {
        const { group, a, b } = await makeGroup();
        vi.spyOn(DB, 'getGroupMessages').mockResolvedValue(messagesFor(group.id));
        await processGroupNewMessages(group, [a, b], '用户');
        const another: GroupProfile = { ...group, id: group.id + '-another', name: '另一群' };
        await DB.saveGroup(another);
        const result = await processGroupNewMessages(another, [a, b], '用户');
        expect(result?.stored).toBe(2);
        expect((await MemoryNodeDB.getByCharId(a.id)).filter(n => n.groupId === group.id)).toHaveLength(1);
        expect((await MemoryNodeDB.getByCharId(a.id)).filter(n => n.groupId === another.id)).toHaveLength(1);
    });

    it('同群两件相近但不同的事件，即使 embedding 高度相似也必须分别保留', async () => {
        const { group, a, b } = await makeGroup();
        vi.spyOn(DB, 'getGroupMessages').mockResolvedValue(messagesFor(group.id));
        vi.mocked(extractGroupMemoriesFromBuffer).mockResolvedValue({
            completed: true,
            drafts: [
                { content: '在【测试群】里，用户周六约定学习。', room: 'study', tags: [], importance: 6, mood: 'neutral', createdAt: 1700000000000 },
                { content: '在【测试群】里，用户周日约定学习。', room: 'study', tags: [], importance: 6, mood: 'neutral', createdAt: 1700086400000 },
            ],
        });
        const outcome = await processGroupNewMessages(group, [a, b], '用户');
        expect(outcome?.stored).toBe(4);
        const notes = (await MemoryNodeDB.getByCharId(a.id)).filter(node => node.groupId === group.id);
        expect(notes.map(node => node.content)).toEqual(expect.arrayContaining([
            '在【测试群】里，用户周六约定学习。',
            '在【测试群】里，用户周日约定学习。',
        ]));
    });

    it('合法空数组也分别推进群/角色水位，不重复调用副 API', async () => {
        const { group, a, b } = await makeGroup();
        vi.spyOn(DB, 'getGroupMessages').mockResolvedValue(messagesFor(group.id));
        vi.mocked(extractGroupMemoriesFromBuffer).mockResolvedValue({ drafts: [], completed: true });
        const first = await processGroupNewMessages(group, [a, b], '用户');
        expect(first?.stored).toBe(0);
        expect(getGroupMemoryPalaceHighWaterMark(group.id)).toBeGreaterThan(0);
        const second = await processGroupNewMessages(group, [a, b], '用户');
        expect(second?.reason).toBe('threshold');
        expect(extractGroupMemoriesFromBuffer).toHaveBeenCalledTimes(1);
    });

    it('副 API 失败或格式错误不能假装空记忆推进游标', async () => {
        const { group, a, b } = await makeGroup();
        vi.spyOn(DB, 'getGroupMessages').mockResolvedValue(messagesFor(group.id));
        vi.mocked(extractGroupMemoriesFromBuffer).mockResolvedValue({ drafts: [], completed: false });
        await processGroupNewMessages(group, [a, b], '用户');
        expect(getGroupMemoryPalaceHighWaterMark(group.id)).toBe(0);
        await processGroupNewMessages(group, [a, b], '用户');
        expect(extractGroupMemoriesFromBuffer).toHaveBeenCalledTimes(2);
    });

    it('补录新成员时只写该成员记忆，不倒退旧成员已完成的群水位', async () => {
        const { group, a, b } = await makeGroup();
        vi.spyOn(DB, 'getGroupMessages').mockResolvedValue(messagesFor(group.id));
        const first = await processGroupNewMessages(group, [a, b], '用户');
        expect(first?.stored).toBe(2);
        const originalWaterline = getGroupMemoryPalaceHighWaterMark(group.id);
        const newcomer = {
            id: group.id + '-newcomer', name: '新成员', memoryPalaceEnabled: true, memories: [],
        } as unknown as CharacterProfile;
        await DB.saveCharacter(newcomer);
        const joinedGroup = { ...group, members: [...group.members, newcomer.id] };
        await DB.saveGroup(joinedGroup);
        const replay = await processGroupNewMessages(joinedGroup, [a, b, newcomer], '用户');
        expect(replay?.stored).toBe(1);
        expect(getGroupMemoryPalaceHighWaterMark(group.id)).toBe(originalWaterline);
        expect((await MemoryNodeDB.getByCharId(newcomer.id)).filter(n => n.groupId === group.id)).toHaveLength(1);
        expect((await MemoryNodeDB.getByCharId(a.id)).filter(n => n.groupId === group.id)).toHaveLength(1);
    });

    it('合法空记忆批次推进水位并继续归档，失败的空结果保留水位', async () => {
        const { group, a, b } = await makeGroup();
        vi.spyOn(DB, 'getGroupMessages').mockImplementation(async id => messagesFor(id));
        vi.mocked(extractGroupMemoriesFromBuffer).mockResolvedValueOnce({ drafts: [], completed: true });
        const empty = await processGroupNewMessages(group, [a, b], '用户');
        expect(empty?.stored).toBe(0);
        expect(empty?.progressed).toBe(true);
        expect(getGroupMemoryPalaceHighWaterMark(group.id)).toBeGreaterThan(0);

        // 没有成功提取结果时不能错误推进原文水位。
        const { group: second, a: c, b: d } = await makeGroup();
        vi.mocked(extractGroupMemoriesFromBuffer).mockResolvedValueOnce({ drafts: [], completed: false });
        const failed = await processGroupNewMessages(second, [c, d], '用户');
        expect(failed?.progressed).toBeUndefined();
        expect(getGroupMemoryPalaceHighWaterMark(second.id)).toBe(0);
    });

    it('本群撤销私聊互通后不写入个人记忆', async () => {
        const { group, a, b } = await makeGroup(false);
        const spy = vi.spyOn(DB, 'getGroupMessages');
        const result = await processGroupNewMessages(group, [a, b], '用户');
        expect(result?.reason).toBe('sync_disabled');
        expect(spy).not.toHaveBeenCalled();
        expect(extractGroupMemoriesFromBuffer).not.toHaveBeenCalled();
    });

    it('群被删除时终止后续写入，并清除该群进度', async () => {
        const { group, a, b } = await makeGroup();
        vi.spyOn(DB, 'getGroupMessages').mockResolvedValueOnce(messagesFor(group.id));
        await processGroupNewMessages(group, [a, b], '用户');
        expect(getGroupMemoryPalaceHighWaterMark(group.id)).toBeGreaterThan(0);
        await deleteGroupMemoriesByGroupId(group.id);
        expect(getGroupMemoryPalaceHighWaterMark(group.id)).toBe(0);
        const result = await processGroupNewMessages(group, [a, b], '用户');
        expect(result?.reason).toBe('group_deleted');
        expect((await MemoryNodeDB.getByCharId(a.id)).some(n => n.groupId === group.id)).toBe(false);
    });
});
