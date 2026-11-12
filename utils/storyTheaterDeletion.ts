import type { StoryTheaterEntry } from '../types';
import type { RemoteVectorConfig } from './memoryPalace/types';
import { DB } from './db';
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