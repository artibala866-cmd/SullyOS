import { afterEach, describe, expect, it, vi } from 'vitest';
import { DB, openDB } from './db';

afterEach(() => vi.restoreAllMocks());

describe('通知前必须确认消息已提交', () => {
    it('消息 add 成功但事务随后中止时，不能让调用方发出成功通知', async () => {
        await openDB();
        const originalAdd = IDBObjectStore.prototype.add;
        vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, ...args: any[]) {
            const request = (originalAdd as any).apply(this, args) as IDBRequest;
            request.addEventListener('success', () => this.transaction.abort());
            return request;
        });
        await expect(DB.saveMessage({
            charId: 'message-abort', role: 'assistant', type: 'text', content: '晚安',
        })).rejects.toBeTruthy();
        expect(await DB.getMessagesByCharId('message-abort', true)).toEqual([]);
    });

    it('消息成功提交后能读到', async () => {
        const id = await DB.saveMessage({ charId: 'message-ok', role: 'assistant', type: 'text', content: '到了' });
        expect((await DB.getMessagesByCharId('message-ok', true))[0].id).toBe(id);
    });
});
