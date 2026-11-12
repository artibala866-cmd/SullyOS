import type { Message, StoryTheaterEntry } from '../types';
import type { RemoteVectorConfig } from './memoryPalace/types';
import { DB, openDB } from './db';
import { storyTheaterMemoryRecipientIds, storyTheaterThreadId } from './storyTheater';
import { deleteStoryVectorMemory, listStoryVectorMemories } from './storyTheaterVectorMemory';

export interface DeleteStoryTheaterResult {
    deletedMessageCount: number;
    deletedVectorCount: number;
    remoteVectorDeleteFailures: number;
}

export async function deleteStoryTheaterData(
    entry: StoryTheaterEntry,
    remoteVectorConfig?: RemoteVectorConfig,
): Promise<DeleteStoryTheaterResult> {
    const threadId = storyTheaterThreadId(entry.id);
    const recipientIds = storyTheaterMemoryRecipientIds(entry);
    const [centralMessages, recipientMessages, vectorNodes] = await Promise.all([
        DB.getMessagesByCharId(threadId, true),
        Promise.all(recipientIds.map(id => DB.getMessagesByCharId(id, true))),
        listStoryVectorMemories(entry.id),
    ]);

    // Old theaterMirrorIds can point at a message that was later reused, moved,
    // or belongs to another story. Never trust an ID alone when deleting history.
    const ownedMirrors = recipientMessages.flat().filter(message =>
        message.metadata?.source === 'story_theater_memory' && message.metadata?.theaterId === entry.id
    );
    const ownedMirrorIds = new Set(ownedMirrors.map(message => message.id));
    // A character may have been removed from the cast after its scene was
    // mirrored. Check those old references by their actual stored ownership.
    const oldReferences = new Set<number>();
    for (const message of centralMessages) {
        for (const id of Object.values((message.metadata?.theaterMirrorIds || {}) as Record<string, number>)) {
            const numericId = Number(id);
            if (Number.isSafeInteger(numericId) && numericId > 0 && !ownedMirrorIds.has(numericId)) {
                oldReferences.add(numericId);
            }
        }
    }
    if (oldReferences.size) {
        const db = await openDB();
        const recovered = await new Promise<number[]>((resolve, reject) => {
            const tx = db.transaction('messages', 'readonly');
            const store = tx.objectStore('messages');
            const found: number[] = [];
            for (const id of oldReferences) {
                const request = store.get(id);
                request.onsuccess = () => {
                    const row = request.result as Message | undefined;
                    if (row?.metadata?.source === 'story_theater_memory' && row.metadata.theaterId === entry.id) {
                        found.push(id);
                    }
                };
            }
            tx.oncomplete = () => resolve(found);
            tx.onerror = () => reject(tx.error || new Error('读取旧剧情镜像失败'));
            tx.onabort = () => reject(tx.error || new Error('旧剧情镜像校验已取消'));
        });
        for (const id of recovered) ownedMirrorIds.add(id);
    }
    const messageIds = new Set<number>(ownedMirrorIds);
    for (const message of centralMessages) {
        messageIds.add(message.id);
        const mirrorIds = Object.values((message.metadata?.theaterMirrorIds || {}) as Record<string, number>);
        for (const id of mirrorIds) {
            const numericId = Number(id);
            if (Number.isSafeInteger(numericId) && numericId > 0 && ownedMirrorIds.has(numericId)) {
                messageIds.add(numericId);
            }
        }
    }

    let remoteVectorDeleteFailures = 0;
    for (const node of vectorNodes) {
        const result = await deleteStoryVectorMemory(entry.id, node.id, remoteVectorConfig);
        if (result.remoteDeleted === false) remoteVectorDeleteFailures += 1;
    }

    if (messageIds.size > 0) await DB.deleteMessages([...messageIds]);
    await DB.deleteStoryTheater(entry.id);
    try { localStorage.removeItem(`mp_lastMsgId_${threadId}`); } catch { /* storage unavailable */ }

    return {
        deletedMessageCount: messageIds.size,
        deletedVectorCount: vectorNodes.length,
        remoteVectorDeleteFailures,
    };
}