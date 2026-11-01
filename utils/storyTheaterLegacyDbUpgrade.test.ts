import { describe, expect, it } from 'vitest';
import { DB, openDB } from './db';
import { createStoryTheaterDraft } from './storyTheater';

/**
 * Regression for real long-lived forks: the database was already v74 when the
 * Meet story tables were later merged into the source. A same-version open
 * never reruns onupgradeneeded, so saving the first theater threw NotFoundError.
 * A v75 upgrade must create only absent tables and keep existing data intact.
 */
describe('见面剧情旧版本数据库无损升级', () => {
    it('补齐版本74缺失的剧情表，保留以前的角色数据，并能保存、重读和更新剧情', async () => {
        const old = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open('AetherOS_Data', 74);
            req.onupgradeneeded = () => {
                const db = req.result;
                const chars = db.createObjectStore('characters', { keyPath: 'id' });
                chars.put({ id: 'old-character', name: '历史角色', memories: [] });
                db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true }).createIndex('charId', 'charId');
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        expect(old.objectStoreNames.contains('story_theaters')).toBe(false);
        old.close();

        const upgraded = await openDB();
        expect(upgraded.version).toBe(75);
        for (const store of ['characters', 'messages', 'story_theaters', 'story_theater_presets', 'story_theater_masks']) {
            expect(upgraded.objectStoreNames.contains(store), store).toBe(true);
        }
        expect((await DB.getCharacter('old-character'))?.name).toBe('历史角色');
        const draft = { ...createStoryTheaterDraft(), id: 'migration-story', title: '可以保存进入的剧情', characterIds: ['old-character'] };
        await DB.saveStoryTheater(draft);
        expect((await DB.getStoryTheaters()).find(e => e.id === draft.id)?.title).toBe(draft.title);
        await DB.saveStoryTheater({ ...draft, title: '继续修改后还能保持' });
        expect((await DB.getStoryTheaters()).find(e => e.id === draft.id)?.title).toBe('继续修改后还能保持');
        expect((await DB.getCharacter('old-character'))?.name).toBe('历史角色');
    });
});
