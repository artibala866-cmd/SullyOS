import { afterEach, describe, expect, it } from 'vitest';
import type { StoryTheaterEntry } from '../types';
import type { MemoryNode } from './memoryPalace/types';
import { MemoryLinkDB, MemoryNodeDB, MemoryVectorDB } from './memoryPalace/db';
import { DB } from './db';
import { storyTheaterThreadId } from './storyTheater';
import { deleteStoryTheaterData } from './storyTheaterDeletion';
import { listStoryVectorMemories } from './storyTheaterVectorMemory';

const ENTRY_A = 'story-delete-a';
const ENTRY_B = 'story-delete-b';
const ACTOR_ID = 'story-delete-char';
const NODE_A = 'story-node-a';
const NODE_B = 'story-node-b';
const LINK_A = 'story-link-a';

const entry = (id: string): StoryTheaterEntry => ({
    id,
    title: id,
    premise: '',
    openingMode: 'user',
    mask: { type: 'user' },
    characterIds: [ACTOR_ID],
    writesToCharacterMemory: true,
    characterMemoryDates: {},
    carryCharacterMemory: true,
    characterContextLimits: { [ACTOR_ID]: 100 },
    archiveAfter: 20,
    archiveKeepRecent: 5,
    archiveStrategy: 'vector',
    archives: [],
    selectedWorldbookIds: [],
    createdAt: 1,
    updatedAt: 1,
});

const node = (id: string, entryId: string): MemoryNode => ({
    id,
    charId: storyTheaterThreadId(entryId),
    content: id,
    room: 'living_room',
    tags: ['剧情'],
    importance: 5,
    mood: 'neutral',
    embedded: true,
    createdAt: 1,
    lastAccessedAt: 1,
    accessCount: 0,
});

describe('删除整个剧情', () => {
    const messageIds: number[] = [];

    afterEach(async () => {
        if (messageIds.length > 0) await DB.deleteMessages(messageIds.splice(0));
        await DB.deleteStoryTheater(ENTRY_A);
        await DB.deleteStoryTheater(ENTRY_B);
        await Promise.all([
            MemoryLinkDB.delete(LINK_A),
            MemoryVectorDB.delete(NODE_A),
            MemoryVectorDB.delete(NODE_B),
            MemoryNodeDB.delete(NODE_A),
            MemoryNodeDB.delete(NODE_B),
        ]);
    });

    it('旧楼层指向普通私聊或另一剧情的镜像 ID，删除时不能误伤', async () => {
        const entryA = entry(ENTRY_A);
        const entryB = entry(ENTRY_B);
        await DB.saveStoryTheater(entryA);
        await DB.saveStoryTheater(entryB);
        const ordinary = await DB.saveMessage({ charId: ACTOR_ID, role: 'user', type: 'text', content: '现实私聊：还记得钥匙吗？' });
        const otherStory = await DB.saveMessage({ charId: ACTOR_ID, role: 'assistant', type: 'text', content: '另一条剧情的回忆', metadata: { source: 'story_theater_memory', theaterId: entryB.id } });
        const owned = await DB.saveMessage({ charId: ACTOR_ID, role: 'assistant', type: 'text', content: '当前剧情的回忆', metadata: { source: 'story_theater_memory', theaterId: entryA.id } });
        const central = await DB.saveMessage({ charId: storyTheaterThreadId(entryA.id), role: 'assistant', type: 'text', content: '陈旧的剧情镜像引用', metadata: { source: 'story_theater', theaterId: entryA.id, theaterMirrorIds: { stolen: ordinary, wrongStory: otherStory, owned } } });
        messageIds.push(ordinary, otherStory, owned, central);

        const result = await deleteStoryTheaterData(entryA);
        expect(result.deletedMessageCount).toBe(2);
        const remaining = await DB.getMessagesByCharId(ACTOR_ID, true);
        expect(remaining.map(row => row.id)).toContain(ordinary);
        expect(remaining.map(row => row.id)).toContain(otherStory);
        expect(remaining.map(row => row.id)).not.toContain(owned);
    });

    it('角色中途退场后仍能按旧引用清除属于本剧情的镜像', async () => {
        const oldActor = 'story-removed-cast';
        const current = entry(ENTRY_A);
        await DB.saveStoryTheater(current);
        const oldMirror = await DB.saveMessage({ charId: oldActor, role: 'assistant', type: 'text', content: '退场角色以前的剧情记忆', metadata: { source: 'story_theater_memory', theaterId: current.id } });
        const normal = await DB.saveMessage({ charId: oldActor, role: 'user', type: 'text', content: '退场角色的普通私聊' });
        const central = await DB.saveMessage({ charId: storyTheaterThreadId(current.id), role: 'assistant', type: 'text', content: '历史楼层', metadata: { source: 'story_theater', theaterId: current.id, theaterMirrorIds: { removedCast: oldMirror, normal } } });
        messageIds.push(oldMirror, normal, central);
        expect((await deleteStoryTheaterData(current)).deletedMessageCount).toBe(2);
        expect((await DB.getMessagesByCharId(oldActor, true)).map(row => row.id)).toEqual([normal]);
    });

    it('只清理选中剧情的条目、楼层、角色镜像与向量分区', async () => {
        const entryA = entry(ENTRY_A);
        const entryB = entry(ENTRY_B);
        await DB.saveStoryTheater(entryA);
        await DB.saveStoryTheater(entryB);

        const mirrorA = await DB.saveMessage({ charId: ACTOR_ID, role: 'assistant', type: 'text', content: 'mirror-a', metadata: { source: 'story_theater_memory', theaterId: entryA.id } });
        const centralA = await DB.saveMessage({ charId: storyTheaterThreadId(entryA.id), role: 'assistant', type: 'text', content: 'central-a', metadata: { source: 'story_theater', theaterId: entryA.id, theaterMirrorIds: { actor: mirrorA } } });
        const mirrorB = await DB.saveMessage({ charId: ACTOR_ID, role: 'assistant', type: 'text', content: 'mirror-b', metadata: { source: 'story_theater_memory', theaterId: entryB.id } });
        messageIds.push(mirrorA, centralA, mirrorB);

        await MemoryNodeDB.save(node(NODE_A, entryA.id));
        await MemoryNodeDB.save(node(NODE_B, entryB.id));
        await MemoryVectorDB.save({ memoryId: NODE_A, charId: storyTheaterThreadId(entryA.id), vector: [0.1], dimensions: 1, model: 'test' });
        await MemoryVectorDB.save({ memoryId: NODE_B, charId: storyTheaterThreadId(entryB.id), vector: [0.2], dimensions: 1, model: 'test' });
        await MemoryLinkDB.save({ id: LINK_A, sourceId: NODE_A, targetId: NODE_B, type: 'temporal', strength: 0.5 });

        const result = await deleteStoryTheaterData(entryA);

        expect(result).toEqual({ deletedMessageCount: 2, deletedVectorCount: 1, remoteVectorDeleteFailures: 0 });
        expect((await DB.getStoryTheaters()).map(item => item.id)).not.toContain(entryA.id);
        expect((await DB.getStoryTheaters()).map(item => item.id)).toContain(entryB.id);
        expect(await DB.getMessagesByCharId(storyTheaterThreadId(entryA.id), true)).toHaveLength(0);
        expect((await DB.getMessagesByCharId(ACTOR_ID, true)).some(message => message.id === mirrorA)).toBe(false);
        expect((await DB.getMessagesByCharId(ACTOR_ID, true)).some(message => message.id === mirrorB)).toBe(true);
        expect(await listStoryVectorMemories(entryA.id)).toHaveLength(0);
        expect(await listStoryVectorMemories(entryB.id)).toHaveLength(1);
        expect(await MemoryLinkDB.getByNodeId(NODE_B)).toHaveLength(0);
    });
});