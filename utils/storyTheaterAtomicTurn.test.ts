import { describe, expect, it, vi } from 'vitest';
import type { Message } from '../types';
import { DB } from './db';
import { saveStoryWithOpening } from './storyTheaterPersistence';
import { createStoryTheaterDraft, createStoryTheaterMirrorMessage, storyTheaterThreadId } from './storyTheater';

const scenario = (suffix: string) => ({
    ...createStoryTheaterDraft(), id: `story-atomic-${suffix}`, title: '原子剧情',
    writesToCharacterMemory: true, characterIds: ['atom-a', 'atom-b'],
});
const turn = (id: string) => ({
    charId: storyTheaterThreadId(id), role: 'user' as const, type: 'text' as const, content: '认真保存这一层',
    timestamp: 1770000000000, metadata: {source: 'story_theater', theaterId: id},
});
const mirrors = (entry: ReturnType<typeof scenario>, centralId: number) => ['atom-a','atom-b']
    .map(charId => createStoryTheaterMirrorMessage(entry, charId, {
        id: centralId, role: 'user', content: '认真保存这一层', timestamp: 1770000000000,
    }));
const list = async (charId: string) => DB.getMessagesByCharId(charId, true);
describe('见面剧情中央正文与角色镜像同事务保存', () => {
    it('一次提交三条记录，中央 ID 正确引用两个镜像，不改动其他会话', async () => {
        const e = scenario('success');
        const centralId = await DB.saveStoryTheaterTurn(turn(e.id), id => mirrors(e, id));
        const central = (await list(storyTheaterThreadId(e.id))).find(m => m.id === centralId)!;
        expect(central).toBeDefined();
        const ids = central.metadata?.theaterMirrorIds || {};
        expect(Object.keys(ids).sort()).toEqual(['atom-a', 'atom-b']);
        for (const charId of ['atom-a','atom-b']) {
            const mirror = (await DB.getMessageById(ids[charId])) as Message;
            expect(mirror).toMatchObject({ charId, role: 'user', content: central.content,
                metadata: {source: 'story_theater_memory', theaterCentralId: centralId,
                    theaterId: e.id, theaterTimestampVersion: 1}});
        }
    });
    it('第二个镜像失败时整轮回滚，中央和第一个镜像均不能残留', async () => {
        const e = scenario('abort');
        const original = IDBObjectStore.prototype.add;
        const spy = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['add']>) {
            if (this.name === 'messages' && (args[0] as Message).charId === 'atom-b') {
                throw new Error('模拟第二个角色镜像写入失败');
            }
            return original.apply(this, args);
        });
        try {
            await expect(DB.saveStoryTheaterTurn(turn(e.id), id => mirrors(e,id)))
                .rejects.toThrow('模拟第二个角色镜像写入失败');
        } finally { spy.mockRestore(); }
        expect((await list(storyTheaterThreadId(e.id))).filter(m => m.metadata?.theaterId === e.id)).toHaveLength(0);
        for (const actor of ['atom-a','atom-b']) {
            expect((await list(actor)).filter(m => m.metadata?.theaterId === e.id)).toHaveLength(0);
        }
    });
    it('非法镜像所属剧情、重复角色均拒绝整轮写入', async () => {
        const e = scenario('invalid');
        await expect(DB.saveStoryTheaterTurn(turn(e.id), id => [
            {...mirrors(e,id)[0], metadata: { ...mirrors(e,id)[0].metadata, theaterId: 'another-story' }},
        ])).rejects.toThrow('副本数据不一致');
        await expect(DB.saveStoryTheaterTurn(turn(e.id), id => {
            const m = mirrors(e,id)[0];
            return [m, {...m}];
        })).rejects.toThrow('副本数据不一致');
        expect((await list(storyTheaterThreadId(e.id))).filter(m=>m.metadata?.theaterId===e.id)).toHaveLength(0);
    });
    it('虚构剧情没有角色镜像，仍可以单独原子写入正文', async () => {
        const e=scenario('fiction');
        const id=await DB.saveStoryTheaterTurn(turn(e.id), ()=>[]);
        const saved=await DB.getMessageById(id);
        expect(saved?.metadata).toMatchObject({source:'story_theater',theaterId:e.id});
        expect(saved?.metadata?.theaterMirrorIds).toBeUndefined();
    });
});

describe('酒馆开场白与剧情首幕原子保存', () => {
    const intro = { characterId: 'intro-a', greetingId: 'tavern-first', content: '雨夜里，两人第一次相遇。' };
    const draft = (suffix: string, real = false) => ({
        ...createStoryTheaterDraft(), id: `greeting-atomic-${suffix}`, title: '雨夜',
        openingGreeting: { characterId: intro.characterId, greetingId: intro.greetingId },
        characterIds: real ? ['intro-a', 'intro-b'] : ['intro-a'],
        writesToCharacterMemory: real,
    });
    it('两个保存并发只能写入一次开场，之后编辑标题也不会重复首幕', async () => {
        const entry = draft('parallel');
        await Promise.all([saveStoryWithOpening(entry, intro, []), saveStoryWithOpening(entry, intro, [])]);
        expect((await DB.getStoryTheaters()).filter(row => row.id === entry.id)).toHaveLength(1);
        const history = await DB.getMessagesByCharId(storyTheaterThreadId(entry.id), true);
        expect(history.filter(row => row.metadata?.source === 'story_theater')).toHaveLength(1);
        expect(history[0]).toMatchObject({ role: 'assistant', content: intro.content, metadata: {
            source: 'story_theater', theaterOpeningGreeting: {
                characterId: 'intro-a', greetingId: 'tavern-first',
            },
        } });
        await saveStoryWithOpening({ ...entry, title: '新标题' }, intro, []);
        expect((await DB.getMessagesByCharId(storyTheaterThreadId(entry.id), true))).toHaveLength(1);
    });
    it('真实陪伴的开场白和两个角色镜像一起保存', async () => {
        const entry = draft('mirror', true);
        await saveStoryWithOpening(entry, intro, ['intro-a', 'intro-b']);
        const center = (await DB.getMessagesByCharId(storyTheaterThreadId(entry.id), true))[0];
        expect(Object.keys(center.metadata?.theaterMirrorIds || {}).sort()).toEqual(['intro-a', 'intro-b']);
        for (const charId of ['intro-a','intro-b']) {
            const mirror = await DB.getMessageById(center.metadata.theaterMirrorIds[charId]);
            expect(mirror).toMatchObject({ charId, content: intro.content, metadata: {
                source: 'story_theater_memory', theaterCentralId: center.id, theaterId: entry.id,
            } });
        }
    });
    it('第二个角色镜像失败则剧情、正文和所有镜像同时回滚', async () => {
        const entry = draft('rollback', true);
        const add = IDBObjectStore.prototype.add;
        const spy = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function(this: IDBObjectStore, ...args: Parameters<IDBObjectStore['add']>) {
            if (this.name === 'messages' && (args[0] as Message).charId === 'intro-b')
                throw new Error('模拟开场白镜像故障');
            return add.apply(this, args);
        });
        try {
            await expect(saveStoryWithOpening(entry, intro, ['intro-a', 'intro-b']))
                .rejects.toThrow('模拟开场白镜像故障');
        } finally { spy.mockRestore(); }
        expect((await DB.getStoryTheaters()).some(row => row.id === entry.id)).toBe(false);
        for (const charId of [storyTheaterThreadId(entry.id), 'intro-a', 'intro-b']) {
            expect((await DB.getMessagesByCharId(charId, true))
                .filter(row => row.metadata?.theaterId === entry.id)).toHaveLength(0);
        }
    });
});
