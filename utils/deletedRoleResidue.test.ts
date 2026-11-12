import { expect, it } from 'vitest';
import type { CharacterProfile, Message } from '../types';
import { DB, findDeletedRoleResidue, openDB } from './db';

const roleId = 'char-1790000000000';
const oldRoleId = 'char-1790000000001';
const message = (charId: string, extra: Partial<Message> = {}) => DB.saveMessage({
    charId, role: 'user', type: 'text', content: 'sample', timestamp: 1, ...extra,
});

it('cleans all owned dialogue including group, story and favorite audio', async () => {
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
    expect(await DB.getMessageById(groupId)).toBeFalsy();
    expect(await findDeletedRoleResidue()).not.toContain(roleId);
    expect(await DB.getMessageById(centralId)).toBeFalsy();
    expect(await DB.getAssetRaw(`voice_msg_${privateId}`)).toBeNull();
    expect(await DB.getAssetRaw(`voice_msg_${favoriteId}`)).toBeNull();
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

it('erases role-specific imports, phone/play records and shared references without erasing another role', async () => {
    const owner = 'char-1790000000800', other = 'char-1790000000801';
    await DB.saveCharacter({
        id: owner, name: '删除目标', mountedWorldbooks: [
            { id: 'wb-owned', title: '专属导入', content: 'secret', cardImportKey: 'import-a' },
            { id: 'wb-common', title: '共享导入', content: 'shared', cardImportKey: 'import-b' },
        ],
    } as CharacterProfile);
    await DB.saveCharacter({
        id: other, name: '其他角色', mountedWorldbooks: [
            { id: 'wb-common', title: '共享导入', content: 'shared', cardImportKey: 'import-b' },
        ],
    } as CharacterProfile);
    const privateMessage = await message(owner);
    const groupMessage = await message(owner, { groupId: 'group-del' });
    const otherMessage = await message(other, { groupId: 'group-del' });
    const orphanGroupMessage = await message('user', { groupId: 'group-solo' });
    const storyMessage = await message('story-theater:story-owner', {
        metadata: { source: 'story_theater' },
    });
    const otherMirror = await message(other, {
        metadata: { source: 'story_theater_memory', theaterCentralId: storyMessage },
    });
    await DB.updateMessageMetadata(storyMessage, metadata => ({
        ...metadata, theaterMirrorIds: { [other]: otherMirror },
    }));
    const db = await openDB();
    const rows: Record<string, any[]> = {
        scheduled_messages: [{ id: 'remind-owner', charId: owner, content: 'owned' }],
        gallery: [{ id: 'gallery-owner', charId: owner, url: 'image' }],
        diaries: [{ id: 'diary-owner', charId: owner, date: '2026-11-12' }],
        tasks: [{ id: 'task-owner', supervisorId: owner, title: 'my task' }],
        anniversaries: [{ id: 'ann-owner', charId: owner }],
        room_todos: [{ id: owner + '_2026-11-12', charId: owner }],
        room_notes: [{ id: 'note-owner', charId: owner }],
        daily_schedule: [{ id: owner + '_2026-11-12', charId: owner }],
        xhs_activities: [{ id: 'xhs-owner', characterId: owner }],
        xhs_owned_posts: [{ id: 'post-owner', characterId: owner }],
        groups: [{ id: 'group-del', members: [owner, other], topicBoxes: [{ id: 'old', summary: 'secret' }] },
            { id: 'group-solo', members: [owner] }],
        social_posts: [
            { id: 'social-owner', authorCharId: owner, comments: [] },
            { id: 'social-other', authorCharId: other, comments: [{ id: 'comment-owner', authorCharId: owner }] },
        ],
        worlds: [{
            id: 'world-shared', memberIds: [owner, other], houses: [{ id: 'house', residentIds: [owner, other] }],
            relationships: [{ fromId: owner, toId: other, value: 50 }],
            threads: [{ id: 'group_main', kind: 'group', memberIds: [owner, other],
                messages: [{ id: 'my-msg', fromId: owner }, { id: 'other-msg', fromId: other }] }],
            seeds: [{ id: 'seed-owner', charId: owner }], directives: [{ id: 'directive-owner', charId: owner }],
        }],
        world_episodes: [
            { id: 'episode-owner', worldId: 'world-shared', beats: [{ charId: owner }] },
            { id: 'episode-other', worldId: 'world-shared', beats: [{ charId: other }] },
        ],
        story_theaters: [{ id: 'story-owner', characterIds: [owner, other] }],
        games: [{ id: 'game-owner', playerCharIds: [owner, other] }],
        novels: [{ id: 'novel-shared', collaboratorIds: [owner, other],
            segments: [{ id: 'segment-owner', authorId: owner }, { id: 'segment-other', authorId: other }] }],
        courses: [{ id: 'course-one', tutorCharId: owner }],
        worldbooks: [
            { id: 'wb-owned', title: '专属导入', content: 'secret', category: '', cardImportKey: 'import-a' },
            { id: 'wb-common', title: '共享导入', content: 'shared', category: '', cardImportKey: 'import-b' },
        ],
        pixel_home_layouts: [{ charId: owner, roomId: 'room-1' }, { charId: other, roomId: 'room-1' }],
        songs: [{ id: 'song-owner', collaboratorId: owner }],
        guidebook: [{ id: 'guide-owner', charId: owner }],
        life_sim: [{ id: 'sim-owner', participantCharIds: [owner, other], actionLog: [] }],
        vr_annotations: [
            { id: 'annotation-owner', novelId: 'novel', authorId: owner },
            { id: 'annotation-reply', novelId: 'novel', authorId: other, targetAnnotationId: 'annotation-owner' },
            { id: 'annotation-other', novelId: 'novel', authorId: other },
        ],
        vr_scripts: [{ id: 'script-owner', authorId: owner }],
        vr_plays: [
            { id: 'play-owner', scriptId: 'script-owner', cast: [] },
            { id: 'play-other', scriptId: 'other-script', cast: [{ actorId: other }] },
        ],
        vr_music: [{ id: 'state', nowPlaying: { charId: owner }, queue: [
            { charId: owner, song: { id: 'a' } }, { charId: other, song: { id: 'b' } },
        ] }],
        vr_guestbook: [{ id: 'board', messages: [
            { id: 'guest-owner', authorId: owner },
            { id: 'guest-reply', authorId: other, replyToId: 'guest-owner' },
            { id: 'guest-other', authorId: other },
        ] }],
        vr_letters: [
            { id: 'letter-owner', charId: owner },
            { id: 'letter-other', charId: other, reply: { charId: owner, content: 'private' } },
        ],
        api_call_log: [
            { id: 'log', entries: [{ charId: owner, id: 'call-owner' }, { charId: other, id: 'call-other' }] },
            { id: 'one-shot-capture', capture: { meta: { charId: owner }, body: 'private' } },
        ],
        vr_settings: [{ id: 'apilog', entries: [{ charId: owner }, { charId: other }] }],
        life_records: [
            { id: 'life-owner', recordedBy: owner }, { id: 'life-other', recordedBy: other },
        ],
        handbook: [{ id: '2026-11-12', pages: [
            { id: 'handbook-owner', charId: owner }, { id: 'handbook-other', charId: other },
        ], layouts: [{ pageNumber: 1, placements: [
            { pageId: 'handbook-owner' }, { pageId: 'handbook-other' },
        ] }] }],
        bank_data: [{ id: 'main_state', shop: {
            staff: [{ id: 'pet-owner', ownerCharId: owner }, { id: 'staff-other', ownerCharId: other }],
            guestbook: [{ id: 'book-owner', charId: owner }, { id: 'book-other', charId: other }],
            activeVisitor: { charId: owner },
        }, firedStaff: [{ id: 'fired-owner', ownerCharId: owner }] }],
    };
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([...Object.keys(rows), 'assets'], 'readwrite');
        for (const [store, items] of Object.entries(rows)) {
            for (const item of items) tx.objectStore(store).put(item);
        }
        tx.objectStore('assets').put({ id: 'content_favorites_index_v1',
            data: { version: 1, items: [
                { id: 'chat-owner', kind: 'chat', charId: owner, snapshot: { content: 'secret' } },
                { id: 'chat-other', kind: 'chat', charId: other, snapshot: { content: 'keep' } },
                { id: 'image-owner', kind: 'image', charId: owner,
                    references: [{ source: 'favorite_asset', assetId: 'content_favorite_image_owner' }] },
            ] } });
        tx.objectStore('assets').put({ id: 'content_favorite_image_owner', data: { imageUrl: 'secret' } });
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
    });
    localStorage.setItem('sully_character_phone_wechat_v1:' + owner, 'private thread');
    localStorage.setItem('sully_character_life_events_v1:' + owner, 'life events');
    localStorage.setItem('sully_character_phone_wechat_v1:' + other, 'other thread');
    expect(await DB.deleteCharacter(owner)).toBe(true);
    expect(await DB.getCharacter(owner)).toBeFalsy();
    expect(await DB.getCharacter(other)).toBeTruthy();
    expect(await DB.getMessageById(privateMessage)).toBeFalsy();
    expect(await DB.getMessageById(groupMessage)).toBeFalsy();
    expect(await DB.getMessageById(storyMessage)).toBeFalsy();
    expect(await DB.getMessageById(otherMirror)).toBeFalsy();
    expect(await DB.getMessageById(otherMessage)).toBeTruthy();
    expect(await DB.getMessageById(orphanGroupMessage)).toBeFalsy();
    for (const [name, deletedId] of [
        ['scheduled_messages', 'remind-owner'], ['gallery', 'gallery-owner'],
        ['diaries', 'diary-owner'], ['tasks', 'task-owner'], ['anniversaries', 'ann-owner'],
        ['room_todos', owner + '_2026-11-12'], ['room_notes', 'note-owner'],
        ['daily_schedule', owner + '_2026-11-12'], ['xhs_activities', 'xhs-owner'],
        ['xhs_owned_posts', 'post-owner'], ['social_posts', 'social-owner'],
        ['world_episodes', 'episode-owner'], ['story_theaters', 'story-owner'],
        ['games', 'game-owner'], ['worldbooks', 'wb-owned'],
        ['songs', 'song-owner'], ['guidebook', 'guide-owner'], ['life_sim', 'sim-owner'],
        ['vr_annotations', 'annotation-owner'], ['vr_annotations', 'annotation-reply'],
        ['vr_scripts', 'script-owner'], ['vr_plays', 'play-owner'], ['vr_letters', 'letter-owner'],
        ['life_records', 'life-owner'],
    ]) {
        expect((await DB.getStoreRowsPage(name, null, 100)).rows.some((row: any) => row.id === deletedId),
            name + '/' + deletedId).toBe(false);
    }
    const pick = async (store: string, id: string) =>
        (await DB.getStoreRowsPage(store, null, 100)).rows.find((row: any) => row.id === id) as any;
    expect((await pick('groups', 'group-del')).members).toEqual([other]);
    expect(await pick('groups', 'group-solo')).toBeUndefined();
    expect((await pick('groups', 'group-del')).topicBoxes).toEqual([]);
    expect((await pick('worlds', 'world-shared')).memberIds).toEqual([other]);
    expect((await pick('worlds', 'world-shared')).threads[0].messages).toHaveLength(1);
    expect((await pick('novels', 'novel-shared')).collaboratorIds).toEqual([other]);
    expect((await pick('novels', 'novel-shared')).segments).toHaveLength(1);
    expect((await pick('courses', 'course-one')).tutorCharId).toBeUndefined();
    expect(await pick('worldbooks', 'wb-common')).toBeTruthy();
    expect(await pick('world_episodes', 'episode-other')).toBeTruthy();
    expect(await pick('vr_annotations', 'annotation-other')).toBeTruthy();
    expect(await pick('vr_plays', 'play-other')).toBeTruthy();
    expect((await pick('vr_music', 'state')).nowPlaying).toBeUndefined();
    expect((await pick('vr_music', 'state')).queue).toHaveLength(1);
    expect((await pick('vr_guestbook', 'board')).messages.map((item: any) => item.id)).toEqual(['guest-other']);
    expect((await pick('vr_letters', 'letter-other')).reply).toBeUndefined();
    expect((await pick('api_call_log', 'log')).entries).toEqual([{ charId: other, id: 'call-other' }]);
    expect(await pick('api_call_log', 'one-shot-capture')).toBeUndefined();
    expect((await pick('vr_settings', 'apilog')).entries).toEqual([{ charId: other }]);
    expect(await pick('life_records', 'life-other')).toBeTruthy();
    expect((await pick('handbook', '2026-11-12')).pages.map((page: any) => page.id))
        .toEqual(['handbook-other']);
    expect((await pick('handbook', '2026-11-12')).layouts[0].placements)
        .toEqual([{ pageId: 'handbook-other' }]);
    expect((await pick('bank_data', 'main_state')).shop.staff.map((item: any) => item.id))
        .toEqual(['staff-other']);
    expect((await pick('bank_data', 'main_state')).shop.guestbook.map((item: any) => item.id))
        .toEqual(['book-other']);
    expect((await pick('bank_data', 'main_state')).shop.activeVisitor).toBeUndefined();
    expect((await pick('bank_data', 'main_state')).firedStaff).toEqual([]);
    expect((await pick('social_posts', 'social-other')).comments).toEqual([]);
    expect((await DB.getAssetRaw('content_favorites_index_v1')).items.map((item: any) => item.id))
        .toEqual(['chat-other']);
    expect(await DB.getAssetRaw('content_favorite_image_owner')).toBeNull();
    expect(localStorage.getItem('sully_character_phone_wechat_v1:' + owner)).toBeNull();
    expect(localStorage.getItem('sully_character_life_events_v1:' + owner)).toBeNull();
    expect(localStorage.getItem('sully_character_phone_wechat_v1:' + other)).toBe('other thread');
    expect((await DB.getStoreRowsPage('pixel_home_layouts', null, 100)).rows).toEqual([
        { charId: other, roomId: 'room-1' },
    ]);
});
