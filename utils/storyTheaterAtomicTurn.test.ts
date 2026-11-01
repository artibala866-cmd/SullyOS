import { describe, expect, it, vi } from 'vitest';
import type { Message } from '../types';
import { DB } from './db';
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
