import { describe, expect, it, vi } from 'vitest';
import { DB } from './db';
import { commitStoryArchiveBatch } from './storyTheaterArchive';
import { createStoryTheaterDraft, storyTheaterThreadId } from './storyTheater';
import type { Message, StoryTheaterArchive } from '../types';

const seed = async (name: string) => {
    const entry = { ...createStoryTheaterDraft(), id: `atomic-archive-${name}`, title: '雨中剧场' };
    await DB.saveStoryTheater(entry);
    const batch: Message[] = [];
    for (const [role, content] of [['user', '原文第一层'], ['assistant', '原文第二层']] as const) {
        const id = await DB.saveMessage({ charId: storyTheaterThreadId(entry.id), role,
            type: 'text', content, timestamp: 1770000000000,
            metadata: { source: 'story_theater', theaterId: entry.id } });
        batch.push((await DB.getMessageById(id))!);
    }
    const box: StoryTheaterArchive = { id: `box-${name}`, strategy: 'summary',
        fromMessageId: batch[0].id, toMessageId: batch[1].id,
        messageCount: 2, summary: '两人撑伞回家', createdAt: Date.now() };
    return { entry, batch, box };
};
const current = async (id:string) => (await DB.getStoryTheaters()).find(entry=>entry.id===id)!;
describe('剧情正文归档与事件盒同事务', () => {
    it('正文与事件盒同时提交，重新打开后没有重复盒或遗失原文', async () => {
        const {entry,batch,box}=await seed('success');
        const updated=await commitStoryArchiveBatch(entry,batch,box);
        expect(updated.archives).toHaveLength(1);
        expect((await current(entry.id)).archives).toEqual(updated.archives);
        const saved=await DB.getMessagesByCharId(storyTheaterThreadId(entry.id),true);
        expect(saved.map(m=>m.content)).toEqual(['原文第一层','原文第二层']);
        expect(saved.every(m=>m.metadata?.theaterArchived && m.metadata?.theaterArchiveStrategy==='summary')).toBe(true);
        await expect(commitStoryArchiveBatch(entry,batch,box)).rejects.toThrow('发生变化');
        expect((await current(entry.id)).archives).toHaveLength(1);
    });
    it('事件盒表写入失败时已标记归档的正文也完全回滚', async () => {
        const {entry,batch,box}=await seed('rollback');
        const original=IDBObjectStore.prototype.put;
        const spy=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,...args:Parameters<IDBObjectStore['put']>){
            if(this.name==='story_theaters')throw new Error('模拟事件盒保存失败');
            return original.apply(this,args);
        });
        try {
            await expect(commitStoryArchiveBatch(entry,batch,box)).rejects.toThrow('模拟事件盒保存失败');
        } finally { spy.mockRestore(); }
        expect((await current(entry.id)).archives).toEqual([]);
        const saved=await DB.getMessagesByCharId(storyTheaterThreadId(entry.id),true);
        expect(saved.map(m=>m.metadata?.theaterArchived)).toEqual([undefined,undefined]);
    });
    it('剧情在归档摘要生成期间被其他窗口修改，拒绝覆盖它的新状态',async()=>{
        const {entry,batch,box}=await seed('concurrent');
        await DB.saveStoryTheater({...entry,premise:'其他窗口已修改',updatedAt:entry.updatedAt+1});
        await expect(commitStoryArchiveBatch(entry,batch,box)).rejects.toThrow('发生变化');
        expect((await current(entry.id)).premise).toBe('其他窗口已修改');
        expect((await current(entry.id)).archives).toHaveLength(0);
    });
    it('一条原文被编辑或提前归档时，不建立不完整事件盒',async()=>{
        const {entry,batch,box}=await seed('edited');
        await DB.updateMessage(batch[1].id,'另一窗口改过的原文');
        await expect(commitStoryArchiveBatch(entry,batch,box)).rejects.toThrow('原文在归档期间发生变化');
        expect((await current(entry.id)).archives).toHaveLength(0);
        const saved=await DB.getMessagesByCharId(storyTheaterThreadId(entry.id),true);
        expect(saved[0].metadata?.theaterArchived).not.toBe(true);
    });
});
