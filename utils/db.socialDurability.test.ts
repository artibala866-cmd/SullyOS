import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { DB, openDB } from './db';
import type { SocialPost } from '../types';

const note = (id: string): SocialPost => ({
    id, authorName: '测试用户', authorAvatar: '', title: '笔记', content: '持久化测试',
    images: [], likes: 0, isCollected: false, isLiked: false, comments: [], timestamp: 1,
    tags: ['测试'], authorType: 'user', authorId: 'user',
});

beforeEach(async () => {
    await openDB();
    await DB.clearSocialPosts();
});
afterEach(() => vi.restoreAllMocks());

function abortSparkOperation(method: 'put' | 'delete' | 'clear') {
    const original = IDBObjectStore.prototype[method];
    return vi.spyOn(IDBObjectStore.prototype, method).mockImplementation(function (this: IDBObjectStore, ...args: any[]) {
        if (this.name === 'social_posts') {
            this.transaction.abort();
            return { onsuccess: null, onerror: null } as unknown as IDBRequest;
        }
        return (original as any).apply(this, args);
    });
}

describe('Spark post durable IndexedDB transactions', () => {
    it('waits for a confirmed saved note', async () => {
        await DB.saveSocialPost(note('saved'));
        expect((await DB.getSocialPosts()).some(p => p.id === 'saved')).toBe(true);
    });
    it('rejects a failed save instead of reporting a false published success', async () => {
        abortSparkOperation('put');
        await expect(DB.saveSocialPost(note('lost'))).rejects.toBeTruthy();
    });
    it('rejects failed deletion and preserves the original note', async () => {
        await DB.saveSocialPost(note('keep'));
        abortSparkOperation('delete');
        await expect(DB.deleteSocialPost('keep')).rejects.toBeTruthy();
        expect((await DB.getSocialPosts()).some(p => p.id === 'keep')).toBe(true);
    });
    it('rejects failed feed clear without destroying existing notes', async () => {
        await DB.saveSocialPost(note('do-not-clear'));
        abortSparkOperation('clear');
        await expect(DB.clearSocialPosts()).rejects.toBeTruthy();
        expect((await DB.getSocialPosts()).some(p => p.id === 'do-not-clear')).toBe(true);
    });
});
