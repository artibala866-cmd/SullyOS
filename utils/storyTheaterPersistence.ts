import type { Message, StoryTheaterEntry } from '../types';
import { DB, openDB } from './db';
import { createStoryTheaterMirrorMessage, storyTheaterThreadId } from './storyTheater';

interface StoryOpening {
    characterId: string;
    greetingId: string;
    content: string;
}

/**
 * A selected greeting is the first real story message. Store the story entry, its
 * first message and all character-memory mirrors in ONE transaction, so an
 * IndexedDB failure cannot leave a story with a missing opening (or vice versa).
 * The read is inside the write transaction to stop two tabs adding two openings.
 */
export async function saveStoryWithOpening(
    entry: StoryTheaterEntry,
    opening: StoryOpening | null,
    recipientIds: string[],
): Promise<void> {
    if (!opening) {
        // Even a story without a greeting must not revive a deleted custom mask.
        if (entry.mask?.type !== 'custom') {
            await DB.saveStoryTheater(entry);
            return;
        }
        const customMaskId = entry.mask.id;
        const db = await openDB();
        const tx = db.transaction(['story_theaters', 'story_theater_masks'], 'readwrite');
        return new Promise<void>((resolve, reject) => {
            let failure: unknown;
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(failure || tx.error || new Error('剧情保存失败'));
            tx.onabort = () => reject(failure || tx.error || new Error('剧情保存已取消'));
            const request = tx.objectStore('story_theater_masks').get(customMaskId);
            request.onsuccess = () => {
                if (!request.result) {
                    failure = new Error('剧情使用的原创身份已不存在，请重新选择身份');
                    try { tx.abort(); } catch { /* already aborted */ }
                    return;
                }
                tx.objectStore('story_theaters').put(entry);
            };
        });
    }
    if (!opening.content.trim() || !entry.characterIds.includes(opening.characterId)) {
        throw new Error('所选剧情开场白已失效，请重新选择');
    }
    const recipients = [...new Set(recipientIds)];
    if (entry.writesToCharacterMemory && recipients.length === 0) {
        throw new Error('真实陪伴剧情没有可写入记忆的角色，请重新选择参与角色');
    }
    const db = await openDB();
    for (const store of ['story_theaters', 'messages', 'assets', 'story_theater_masks']) {
        if (!db.objectStoreNames.contains(store)) {
            throw new Error('剧情本地数据库尚未完成升级，请关闭旧标签页后重试，切勿清空数据');
        }
    }
    const threadId = storyTheaterThreadId(entry.id);
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['story_theaters', 'messages', 'assets', 'story_theater_masks'], 'readwrite');
        const stories = tx.objectStore('story_theaters');
        const messages = tx.objectStore('messages');
        const assets = tx.objectStore('assets');
        const inserted: Array<{ charId: string; id: number }> = [];
        let failure: unknown;
        tx.oncomplete = () => {
            // Match DB.saveStoryTheaterTurn's post-commit memory watermark cleanup.
            try {
                for (const row of inserted) {
                    const key = `mp_lastMsgId_${row.charId}`;
                    const hwm = parseInt(localStorage.getItem(key) || '0', 10) || 0;
                    if (hwm >= row.id) localStorage.removeItem(key);
                }
            } catch { /* restricted storage */ }
            resolve();
        };
        tx.onerror = () => reject(failure || tx.error || new Error('剧情开场白保存失败'));
        tx.onabort = () => reject(failure || tx.error || new Error('剧情开场白保存已回滚，原剧情未修改'));
        const abort = (error: unknown) => {
            failure = error;
            try { tx.abort(); } catch { /* already aborted */ }
        };
        const invalidateMemoryMark = (charId: string, id: number) => {
            inserted.push({ charId, id });
            const key = `mp_hwm_v1_${charId}`;
            const request = assets.get(key);
            request.onsuccess = () => {
                const mirror = request.result?.data;
                const hwm = typeof mirror === 'number' ? mirror : Number(mirror?.msgId);
                if (Number.isFinite(hwm) && hwm >= id) assets.delete(key);
            };
        };

        const saveOpening = () => {
            const request = messages.index('charId').getAll(IDBKeyRange.only(threadId));
            request.onsuccess = () => {
            try {
                const existing = (request.result as Message[]).some(
                    message => message.metadata?.source === 'story_theater',
                );
                if (existing) {
                    stories.put(entry);
                    return;
                }
                const now = Date.now();
                const central: Omit<Message, 'id'> = {
                    charId: threadId, role: 'assistant', type: 'text',
                    content: opening.content, timestamp: now,
                    metadata: {
                        source: 'story_theater', theaterId: entry.id,
                        theaterOpeningGreeting: {
                            characterId: opening.characterId, greetingId: opening.greetingId,
                        },
                    },
                };
                const added = messages.add(central);
                added.onsuccess = () => {
                    try {
                        const centralId = Number(added.result);
                        invalidateMemoryMark(threadId, centralId);
                        const mirrors = entry.writesToCharacterMemory
                            ? recipients.map(charId => createStoryTheaterMirrorMessage(entry, charId, {
                                id: centralId, role: 'assistant', content: opening.content, timestamp: now,
                            }))
                            : [];
                        if (!mirrors.length) {
                            stories.put(entry);
                            return;
                        }
                        const mirrorIds: Record<string, number> = {};
                        let remaining = mirrors.length;
                        for (const mirror of mirrors) {
                            const mirrorAdd = messages.add(mirror);
                            mirrorAdd.onsuccess = () => {
                                try {
                                    const id = Number(mirrorAdd.result);
                                    mirrorIds[mirror.charId] = id;
                                    invalidateMemoryMark(mirror.charId, id);
                                    if (--remaining === 0) {
                                        messages.put({
                                            ...central, id: centralId,
                                            metadata: { ...central.metadata, theaterMirrorIds: mirrorIds },
                                        });
                                        stories.put(entry);
                                    }
                                } catch (error) { abort(error); }
                            };
                        }
                    } catch (error) { abort(error); }
                };
            } catch (error) { abort(error); }
            };
        };
        if (entry.mask?.type === 'custom') {
            const maskRequest = tx.objectStore('story_theater_masks').get(entry.mask.id);
            maskRequest.onsuccess = () => {
                if (!maskRequest.result) {
                    abort(new Error('剧情使用的原创身份已不存在，请重新选择身份'));
                    return;
                }
                saveOpening();
            };
        } else {
            saveOpening();
        }
    });
}

/**
 * Never delete a custom identity while a saved story still references it.
 * Both the reference check and deletion are in one transaction, so other tabs
 * cannot race the check and leave a dangling saved mask selection.
 */
export async function deleteUnusedStoryMask(maskId: string): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(['story_theaters', 'story_theater_masks'], 'readwrite');
    return new Promise<void>((resolve, reject) => {
        let failure: unknown;
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(failure || tx.error || new Error('原创人物删除失败'));
        tx.onabort = () => reject(failure || tx.error || new Error('原创人物删除已取消'));
        const request = tx.objectStore('story_theaters').getAll();
        request.onsuccess = () => {
            try {
                const linked = (request.result as StoryTheaterEntry[])
                    .find(entry => entry.mask?.type === 'custom' && entry.mask.id === maskId);
                if (linked) {
                    throw new Error(`原创人物仍被剧情「${linked.title}」使用。请先在尚未开始的剧情中更换身份，或保留这张面具以免破坏历史。`);
                }
                tx.objectStore('story_theater_masks').delete(maskId);
            } catch (error) {
                failure = error;
                try { tx.abort(); } catch { /* already aborted */ }
            }
        };
    });
}
