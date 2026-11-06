import type { CharacterProfile, Message } from '../types';
import { openDB } from './db';
import { loadCharacterContextMessages } from './chatContextRange';

/** 本剧情原文已有独立历史槽位，角色镜像不得重复注入或带回待重写回复。 */
export async function loadStoryActorContext(char: CharacterProfile, theaterId: string, limit: number): Promise<Message[]> {
    if (limit <= 0) return [];
    const messages = await loadCharacterContextMessages(char);
    return messages.filter(message => !(message.metadata?.source === 'story_theater_memory' && message.metadata?.theaterId === theaterId)).slice(-limit);
}

export const STORY_REROLL_INSTRUCTION = '本轮是重新生成：从同一处故事落点重新写这一轮，换一个合理的切入角度、对白和细节展开；保留已确立的事实和用户输入，不把这次操作写进故事，不把尚未发生的旧版本当作既定经历。';

/** 成功后一次事务替换正文和镜像；失败/并发编辑时保留原文，不先删后写。 */
export async function replaceStoryTheaterReply(original: Message, content: string, metadata: Record<string, unknown>): Promise<void> {
    if (original.role !== 'assistant' || original.metadata?.source !== 'story_theater'
        || !original.metadata.theaterId || original.charId !== `story-theater:${original.metadata.theaterId}`) {
        throw new Error('当前消息不是有效的剧情正文，拒绝修改角色记录');
    }
    if (original.metadata.theaterOpeningGreeting) {
        throw new Error('选定的开场内容不能重新生成；如需修改，请编辑这一层');
    }
    const mirrorEntries = Object.entries((original.metadata.theaterMirrorIds || {}) as Record<string, number>);
    const expectedById = new Map<number, string>();
    for (const [charId, id] of mirrorEntries) {
        if (!charId || !Number.isSafeInteger(id) || id <= 0 || expectedById.has(id)) {
            throw new Error('剧情角色记忆镜像引用已损坏，拒绝重写');
        }
        expectedById.set(id, charId);
    }
    const ids = [original.id, ...expectedById.keys()];
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('messages', 'readwrite');
        const store = transaction.objectStore('messages');
        let failure: Error | undefined;
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(failure || transaction.error || new Error('重写保存失败，原回复已保留'));
        for (const id of ids) {
            const request = store.get(id);
            request.onsuccess = () => {
                const current = request.result as Message | undefined;
                const expectedChar = expectedById.get(id);
                const validIdentity = id === original.id
                    ? current?.charId === original.charId && current?.role === 'assistant'
                        && current?.metadata?.source === 'story_theater'
                        && current?.metadata?.theaterId === original.metadata?.theaterId
                    : current?.charId === expectedChar && current?.role === 'assistant'
                        && current?.metadata?.source === 'story_theater_memory'
                        && current?.metadata?.theaterId === original.metadata?.theaterId
                        && current?.metadata?.theaterCentralId === original.id;
                if (!current || !validIdentity || current.content !== original.content
                    || (id === original.id && !!current.metadata?.theaterOpeningGreeting)) {
                    failure = new Error('剧情正文或角色镜像已被修改、删除或引用错误，已保留原数据，请刷新后重试');
                    transaction.abort();
                    return;
                }
                store.put({ ...current, content, ...(id === original.id ? { metadata: { ...current.metadata, ...metadata } } : {}) });
            };
        }
    });
}
