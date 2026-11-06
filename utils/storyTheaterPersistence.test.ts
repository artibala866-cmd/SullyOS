import { describe, expect, it, vi } from 'vitest';
import type { Message, StoryTheaterEntry, StoryTheaterMask } from '../types';
import { DB } from './db';
import { assertStoryApiConfigured, createStoryTheaterDraft, storyTheaterThreadId } from './storyTheater';
import { deleteUnusedStoryMask, saveStoryWithOpening } from './storyTheaterPersistence';

const makeEntry = (id: string, memory = false): StoryTheaterEntry => ({
    ...createStoryTheaterDraft(),
    id, title: '防止半成品的剧情', characterIds: memory ? ['story-persist-a', 'story-persist-b'] : ['story-persist-a'],
    writesToCharacterMemory: memory,
    openingGreeting: { characterId: 'story-persist-a', greetingId: 'greeting-1' },
});
const greeting = { characterId: 'story-persist-a', greetingId: 'greeting-1', content: '雨夜开场白' };
const rows = async (entry: StoryTheaterEntry) => (
    (await DB.getMessagesByCharId(storyTheaterThreadId(entry.id), true))
        .filter(row => row.metadata?.source === 'story_theater')
);

describe('剧情开场白与剧场条目原子持久化', () => {
    it('一次事务写入开场白与剧情，再次保存不会复制第一幕', async () => {
        const entry = makeEntry('story-opening-atomic-once');
        await saveStoryWithOpening(entry, greeting, []);
        expect((await DB.getStoryTheaters()).find(row => row.id === entry.id)?.openingGreeting).toEqual(entry.openingGreeting);
        expect(await rows(entry)).toMatchObject([{ role: 'assistant', content: greeting.content,
            metadata: { source: 'story_theater', theaterOpeningGreeting: { greetingId: 'greeting-1' } } }]);
        await saveStoryWithOpening({ ...entry, title: '再次编辑' }, greeting, []);
        expect(await rows(entry)).toHaveLength(1);
        expect((await DB.getStoryTheaters()).find(row => row.id === entry.id)?.title).toBe('再次编辑');
    });

    it('真实陪伴的开场白和多角色镜像在同一次事务中提交', async () => {
        const entry = makeEntry('story-opening-atomic-mirrors', true);
        await saveStoryWithOpening(entry, greeting, entry.characterIds);
        const [central] = await rows(entry);
        expect(central.metadata?.theaterMirrorIds).toBeDefined();
        for (const charId of entry.characterIds) {
            const mirrorId = central.metadata.theaterMirrorIds[charId];
            const mirror = await DB.getMessageById(mirrorId);
            expect(mirror).toMatchObject({ charId, role: 'assistant', content: greeting.content,
                metadata: { source: 'story_theater_memory', theaterCentralId: central.id, theaterId: entry.id } });
        }
    });

    it('任意一个角色镜像失败会回滚整个剧情和全部开场白', async () => {
        const entry = makeEntry('story-opening-atomic-rollback', true);
        const original = IDBObjectStore.prototype.add;
        const spy = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['add']>) {
            if (this.name === 'messages' && (args[0] as Message).charId === 'story-persist-b') {
                throw new Error('模拟第二个镜像保存失败');
            }
            return original.apply(this, args);
        });
        try {
            await expect(saveStoryWithOpening(entry, greeting, entry.characterIds)).rejects.toThrow('模拟第二个镜像保存失败');
        } finally { spy.mockRestore(); }
        expect((await DB.getStoryTheaters()).find(row => row.id === entry.id)).toBeUndefined();
        expect(await rows(entry)).toHaveLength(0);
        for (const charId of entry.characterIds) {
            expect((await DB.getMessagesByCharId(charId, true)).filter(row => row.metadata?.theaterId === entry.id)).toHaveLength(0);
        }
    });

    it('已有第一幕时只更新剧情条目，不覆盖先前历史', async () => {
        const entry = makeEntry('story-opening-atomic-existing');
        await DB.saveStoryTheater(entry);
        await DB.saveMessage({ charId: storyTheaterThreadId(entry.id), role: 'user', type: 'text',
            content: '最初是我先开场', timestamp: 10, metadata: { source: 'story_theater', theaterId: entry.id } });
        await saveStoryWithOpening({ ...entry, title: '编辑后的名字' }, greeting, []);
        expect((await rows(entry)).map(row => row.content)).toEqual(['最初是我先开场']);
        expect((await DB.getStoryTheaters()).find(row => row.id === entry.id)?.title).toBe('编辑后的名字');
    });
});

describe('原创面具删除保护', () => {
    const makeMask = (id: string): StoryTheaterMask => ({ id, name: '面具', description: '原始身份',
        createdAt: 1, updatedAt: 1 });
    it('正被已保存剧情引用时拒绝删除，保留身份与正文归属', async () => {
        const mask = makeMask('story-mask-in-use');
        const entry = { ...makeEntry('story-using-custom-mask'), mask: { type: 'custom' as const, id: mask.id } };
        await DB.saveStoryTheaterMask(mask);
        await DB.saveStoryTheater(entry);
        await expect(deleteUnusedStoryMask(mask.id)).rejects.toThrow('仍被剧情');
        expect((await DB.getStoryTheaterMasks()).find(item => item.id === mask.id)).toEqual(mask);
        expect((await DB.getStoryTheaters()).find(item => item.id === entry.id)?.mask).toEqual(entry.mask);
    });
    it('没有剧情引用的面具可以正常删除，其他剧情不变', async () => {
        const mask = makeMask('story-mask-free');
        await DB.saveStoryTheaterMask(mask);
        await deleteUnusedStoryMask(mask.id);
        expect((await DB.getStoryTheaterMasks()).find(item => item.id === mask.id)).toBeUndefined();
    });
});

describe('剧情主 API 参数前置校验', () => {
    it('缺失或非法主 API 时先阻止请求，而不是写入孤立的用户正文', () => {
        expect(() => assertStoryApiConfigured({ baseUrl: '', model: 'm' })).toThrow('主 API 地址');
        expect(() => assertStoryApiConfigured({ baseUrl: 'https://example.com/v1', model: '' })).toThrow('主 API 模型');
        expect(() => assertStoryApiConfigured({ baseUrl: 'not-a-url', model: 'm' })).toThrow('地址无效');
        expect(() => assertStoryApiConfigured({ baseUrl: 'file:///tmp/a', model: 'm' })).toThrow('地址无效');
        expect(() => assertStoryApiConfigured({ baseUrl: 'https://example.com/v1', model: 'm' })).not.toThrow();
    });
});
