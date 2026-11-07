import { expect, it } from 'vitest';
import type { CharacterProfile, Message } from '../types';
import { DB, findDeletedRoleResidue, openDB } from './db';

const roleId = 'char-1790000000000';
const oldRoleId = 'char-1790000000001';
const message = (charId: string, extra: Partial<Message> = {}) => DB.saveMessage({
    charId, role: 'user', type: 'text', content: 'sample', timestamp: 1, ...extra,
});

it('cleans role-owned data atomically while preserving group, central story and favorite audio', async () => {
    await DB.saveCharacter({ id: roleId, name: '测试角色' } as CharacterProfile);
    const privateId = await message(roleId);
    const favoriteId = await message(roleId);
    const groupId = await message(roleId, { groupId: 'shared' });
    const centralId = await message(roleId, { metadata: { source: 'story_theater' } });
    const mirrorId = await message(roleId, { metadata: { source: 'story_theater_memory', theaterCentralId: centralId } });
    await DB.updateMessageMetadata(centralId, metadata => ({ ...metadata, theaterMirrorIds: { [roleId]: mirrorId, other: 900 } }));
    await DB.saveAssetRaw(`voice_msg_${privateId}`, { favorite: false });
    await DB.saveAssetRaw(`voice_msg_${favoriteId}`, { favorite: true });
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['memory_nodes', 'memory_vectors', 'memory_links'], 'readwrite');
        tx.objectStore('memory_nodes').put({ id: 'mine', charId: roleId });
        tx.objectStore('memory_nodes').put({ id: 'other', charId: 'other' });
        tx.objectStore('memory_vectors').put({ memoryId: 'mine' });
        tx.objectStore('memory_links').put({ id: 'related', sourceId: 'other', targetId: 'mine' });
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
    });
    expect(await DB.deleteCharacter(roleId)).toBe(true);
    expect(await DB.getCharacter(roleId)).toBeFalsy();
    expect(await DB.getMessageById(privateId)).toBeFalsy();
    expect(await DB.getMessageById(mirrorId)).toBeFalsy();
    expect(await DB.getMessageById(groupId)).toBeTruthy();
    expect((await DB.getMessageById(centralId))?.metadata?.theaterMirrorIds).toEqual({ other: 900 });
    expect(await DB.getAssetRaw(`voice_msg_${privateId}`)).toBeNull();
    expect(await DB.getAssetRaw(`voice_msg_${favoriteId}`)).toEqual({ favorite: true });
    expect((await DB.getStoreRowsPage('memory_nodes', null, 10)).rows).toEqual([{ id: 'other', charId: 'other' }]);
    expect((await DB.getStoreRowsPage('memory_vectors', null, 10)).rows).toEqual([]);
    expect((await DB.getStoreRowsPage('memory_links', null, 10)).rows).toEqual([]);
});

it('rechecks a restored role and discards late voice writes for deleted messages', async () => {
    const staleId = await message(oldRoleId);
    await message('story-theater:independent');
    expect(await findDeletedRoleResidue()).toContain(oldRoleId);
    expect(await findDeletedRoleResidue()).not.toContain('story-theater:independent');
    await DB.saveCharacter({ id: oldRoleId, name: '恢复的角色' } as CharacterProfile);
    expect(await DB.deleteCharacter(oldRoleId, true)).toBe(false);
    expect(await DB.getMessageById(staleId)).toBeTruthy();
    await DB.deleteMessage(staleId);
    await DB.saveVoiceCacheForMessage(staleId, { favorite: false });
    expect(await DB.getAssetRaw(`voice_msg_${staleId}`)).toBeNull();
    await DB.saveAssetRaw(`voice_msg_${staleId}`, { favorite: false });
    expect(await DB.cleanupOrphanVoiceCaches()).toBe(1);
    expect(await DB.getAssetRaw(`voice_msg_${staleId}`)).toBeNull();
});
