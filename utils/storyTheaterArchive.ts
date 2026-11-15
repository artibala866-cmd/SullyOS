import type { APIConfig, Message, StoryArchiveFact, StoryTheaterArchive, StoryTheaterArchiveStrategy, StoryTheaterEntry } from '../types';
import { DB, openDB } from './db';
import { extractContent, safeResponseJson } from './safeApi';
import { describeStoryApiError, makeStoryTheaterId, resolveStoryTheaterWorldbooks, storyAffinityInputsFromMessage, storyArchiveAtFloor, storyTheaterThreadId } from './storyTheater';
import { hasSummaryReasoningLeak } from './summaryReasoning';
import { resolveStoryMemoryApi } from './storyMemoryApi';
import { tavernOpeningSceneText } from './tavernOpeningGreeting';
import { isGlobalStreamEnabled } from './streamUpgrade';
import { runStoryArchiveOperation } from './storyTheaterBackground';
import type { EmbeddingConfig, MemoryNode, MemoryVector, RemoteVectorConfig } from './memoryPalace/types';
import { vectorizeAndStore } from './memoryPalace/vectorStore';
import { EMBEDDING_MAX_INPUT_CHARS } from './memoryPalace/embedding';
import { ensureFloat32 } from './memoryPalace/db';
import { bm25Index } from './memoryPalace/bm25Index';
import { notifyMemoryNodesChanged } from './memoryPalace/nodeChanges';
import { deleteVector } from './memoryPalace/supabaseVector';
import { normalizeStoryArchiveGuideMaxChars } from './storyArchiveLength';

import { collectStoryArchiveFacts, formatStoryArchiveFacts, parseStoryArchiveChanges, rankStoryArchiveFacts, STORY_INCREMENTAL_ARCHIVE_INSTRUCTION } from './storyArchiveFacts';
import { loadStoryVectorRecall } from './storyTheaterVectorMemory';

const storyArchiveCharacterCount = (text: string) => Array.from(text).length;

/**
 * The same role cards and explicitly selected worldbooks as story prose are
 * reference-only material for extraction, never evidence of a new plot event.
 */
export async function buildStoryArchiveReference(entry: StoryTheaterEntry): Promise<string> {
    const descriptions: string[] = [];
    if (entry.premise?.trim()) descriptions.push('剧情原有前提：' + entry.premise.trim().slice(0, 1100));
    try {
        const [characters, worldbooks] = await Promise.all([DB.getAllCharacters(), DB.getAllWorldbooks()]);
        const participants = characters.filter(char => entry.characterIds.includes(char.id));
        for (const char of participants.slice(0, 8)) {
            const parts = [
                char.description && '人物档案：' + char.description.trim().slice(0, 850),
                char.systemPrompt && '已有核心人设：' + char.systemPrompt.trim().slice(0, 850),
                char.worldview && '已有世界观：' + char.worldview.trim().slice(0, 650),
            ].filter(Boolean);
            if (parts.length) descriptions.push('【' + char.name + '】\n' + parts.join('\n'));
        }
        const selected = new Set(entry.selectedWorldbookIds ?? []);
        const books = resolveStoryTheaterWorldbooks(worldbooks, characters)
            .filter(book => selected.has(book.id) && book.disable !== true);
        for (const book of books.slice(0, 12)) {
            if (book.content?.trim()) descriptions.push('【世界书：' + book.title + '】' + book.content.trim().slice(0, 800));
        }
    } catch (error) {
        // Keep source-only archiving available when local reference storage fails.
        console.warn('[StoryTheater] archive baseline reference read failed', error);
    }
    return descriptions.join('\n\n').slice(0, 9200);
}


/** Summaries must come from the final channel, never a reasoning-only fallback. */
export function parseStoryArchiveSummary(data: any): string {
    const choice = data?.choices?.[0];
    if (data?.error) throw new Error(describeStoryApiError(200, data));
    if (data?.__sullyRawStreamTerminal === false || data?.__sullyTruncatedJson || data?.__sullyBodyReadError || data?.__sullyInvalidStreamFrames) {
        const detail = data?.__sullyBodyReadError;
        throw new Error(`事件盒响应不完整${detail ? `（${detail}）` : ''}，原正文未归档`);
    }
    const reason = String(choice?.finish_reason ?? choice?.finishReason ?? '').toLowerCase();
    if (['length', 'max_tokens', 'max_output_tokens'].includes(reason)) {
        throw new Error('事件盒总结已达到输出上限，未保存；请降低模型思考量或换模型后重试');
    }
    if (reason === 'content_filter' || reason === 'safety') throw new Error(`事件盒总结被接口拦截（${reason}），未保存`);
    if (['error', 'failed', 'cancelled', 'canceled', 'incomplete'].includes(reason)) throw new Error(`事件盒生成中断（${reason}），原正文未归档`);
    const raw = choice?.message?.content;
    const content = Array.isArray(raw)
        ? raw.filter(part => !part?.type || !/thinking|reasoning/i.test(part.type))
        : raw;
    const summary = extractContent({ choices: [{ message: { content } }] });
    if (!summary) throw new Error('模型没有返回事件盒正文（可能只返回了思维链），未保存；请重试');
    if (hasSummaryReasoningLeak(summary)) throw new Error('事件盒总结混入了推理过程，未保存；请重试');
    // Preserve every complete model-generated character, regardless of the advisory length.
    // Incomplete responses, reasoning leakage and invalid section formats remain rejected.
    return summary;
}

function storyArchiveAffinity(message: Message): string[] {
    return storyAffinityInputsFromMessage(message).map(({ characterId, characterName, delta, reason, awareness }) => {
        const displayedName = characterName === '当前角色' && characterId ? characterId : characterName;
        const character = (displayedName || characterId || '当前角色').replace(/\s+/g, ' ');
        const visibility = awareness === 'noticed' ? '允许察觉' : '未告知角色';
        return character + ' · 用户对角色 · ' + (delta >= 0 ? '+' : '') + delta + ' · ' + visibility
            + (reason ? ' · 原因：' + reason.replace(/\s+/g, ' ') : '');
    });
}

function storyArchiveTranscript(messages: Message[], firstFloor: number) {
    const affinity: string[] = [];
    const sources = new Map<number, { text: string; authorInput: boolean; floorNumber: number }>();
    const transcript = messages.map((message, index) => {
        const sourceText = message.metadata?.theaterOpeningGreeting
            ? tavernOpeningSceneText(message.content)
            : message.content;
        const content = extractContent({ choices: [{ message: { content: sourceText } }] });
        if (!content) throw new Error('事件盒原文缺少正文，未生成总结');
        if (!message.metadata?.theaterContinue) {
            sources.set(message.id, { text: content, authorInput: message.role === 'user', floorNumber: firstFloor + index });
        }
        const speaker = message.role === 'assistant' ? '剧场正文'
            : message.metadata?.theaterContinue ? '续写操作，无新增用户行动' : '用户推进';
        const floor = '第 ' + (firstFloor + index) + ' 楼';
        const affinityRows = storyArchiveAffinity(message);
        affinity.push(...affinityRows.map(row => floor + ' · ' + row));
        return message.metadata?.theaterContinue
            ? '[' + floor + ' · 续写操作（无新事实，不作为来源）]'
            : '[' + floor + ' · ' + speaker + ' · 记录ID ' + message.id + ']\n' + content
            + (affinityRows.length ? '\n界面好感记录：\n' + affinityRows.join('\n') : '');
    }).join('\n\n');
    return { affinity, transcript, sources };
}

/** Keep adjacent user and assistant floors together. Oversized turns get their own request. */
export function splitStoryArchiveBatches(rows: Message[]): Message[][] {
    const maxFloors = 12;
    const maxSourceChars = 12000;
    const batches: Message[][] = [];
    let current: Message[] = [];
    let sourceChars = 0;
    for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        const next = rows[index + 1];
        const turn = row.role === 'user' && next?.role === 'assistant' ? [row, next] : [row];
        const size = turn.reduce((sum, message) => sum + message.content.length, 0);
        if (current.length && (current.length + turn.length > maxFloors || sourceChars + size > maxSourceChars)) {
            batches.push(current);
            current = [];
            sourceChars = 0;
        }
        current.push(...turn);
        sourceChars += size;
        index += turn.length - 1;
    }
    if (current.length) batches.push(current);
    return batches;
}

async function requestArchiveCompletion(api: Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>, instruction: string, input: string, storyOnlyProvider?: boolean, strategy?: StoryTheaterArchiveStrategy) {
    const stream = !storyOnlyProvider && isGlobalStreamEnabled();
    const response = await fetch(`${api.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(api.apiKey ? { Authorization: `Bearer ${api.apiKey}` } : {}) },
        body: JSON.stringify({ model: api.model, stream, ...(stream ? { stream_options: { include_usage: true } } : {}), temperature: 0.2, messages: [
            { role: 'system', content: instruction },
            { role: 'user', content: input },
        ] }),
        __sullyMeta: { appId: 'date', appName: '见面', purpose: strategy === 'vector' ? '剧情独立向量 · 总结' : '剧情事件盒总结' },
        // Consume the stream here so a completed but unclosed response cannot block prose.
        __sullySkipStreamUpgrade: true,
    } as RequestInit);
    const data = await safeResponseJson(response, { keepInterruptedBody: true });
    if (!response.ok) throw new Error(describeStoryApiError(response.status, data));
    return parseStoryArchiveSummary(data);
}

export async function generateStoryArchiveDelta(
    entry: StoryTheaterEntry, batch: Message[], api: Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>,
    firstFloor: number, strategy: StoryTheaterArchiveStrategy,
): Promise<{ summary: string; facts: StoryArchiveFact[]; affinityLog: string[] }> {
    if (!api.baseUrl || !api.model) throw new Error('请先配置主 API');
    const batches = splitStoryArchiveBatches(batch);
    if (!batches.length) throw new Error('请先选择要归档的楼层');
    let floor = firstFloor;
    const segments = batches.map(rows => {
        const segment = storyArchiveTranscript(rows, floor);
        floor += rows.length;
        return segment;
    });
    const floorNumbers = new Map<number, number>(segments.flatMap(segment =>
        [...segment.sources].map(([id, source]) => [id, source.floorNumber] as const)));
    const beforeId = batch[0].id;
    const [reference, vector] = await Promise.all([
        buildStoryArchiveReference(entry),
        loadStoryVectorRecall(entry, beforeId),
    ]);
    const known = new Map(collectStoryArchiveFacts(entry.archives, beforeId, vector.factTextById).map(fact => [fact.key, fact]));
    const legacy = [
        ...entry.archives.filter(box => !box.facts && box.toMessageId < beforeId && box.summary)
            .sort((a, b) => b.toMessageId - a.toMessageId).slice(0, 4).map(box => box.summary),
        ...vector.groups.slice(-4).map(group => group.nodes.map(node => node.content).join('')),
    ].filter(Boolean).join('\n\n').slice(0, 6000);
    const affinity = segments.flatMap(segment => segment.affinity);
    const affinityLog = affinity.length ? ['界面好感记录（用户→角色）：', ...affinity] : [];
    const saveMaxChars = normalizeStoryArchiveGuideMaxChars(entry.archiveSummaryGuideMaxChars);
    if (saveMaxChars > 0 && storyArchiveCharacterCount(affinityLog.join('\n')) > saveMaxChars) {
        throw new Error('归档保存上限不足以容纳界面好感记录，本次未调用总结 API');
    }
    const changed = new Map<string, StoryArchiveFact>();
    for (const [index, { sources, transcript }] of segments.entries()) {
        const current = [...known.values()];
        const previous: Array<Pick<StoryArchiveFact, 'key' | 'kind' | 'text' | 'storyTime'>> = [];
        let used = 0;
        for (const { key, kind, text, storyTime } of rankStoryArchiveFacts(current, transcript)) {
            const reference = { key, kind, text, ...(storyTime ? { storyTime } : {}) };
            const size = JSON.stringify(reference).length;
            if (used + size > 12000) continue;
            previous.push(reference);
            used += size;
        }
        const input = [
            `剧情：${entry.title}（第 ${index + 1}/${segments.length} 批）`,
            '已有结构化记忆（用于核对）\n' + JSON.stringify(previous),
            ...(reference ? ['现有剧情设定与人设/世界书（仅用于判断已有设定，不是新事件证据）\n' + reference] : []),
            ...(legacy ? ['旧版归档（用于识别重提的旧事）\n' + legacy] : []),
            '本批新楼层\n' + transcript,
        ].join('\n\n');
        try {
            const raw = await requestArchiveCompletion(api, STORY_INCREMENTAL_ARCHIVE_INSTRUCTION, input, !!entry.memorySummaryApi, strategy);
            for (const fact of parseStoryArchiveChanges(raw, sources, current, reference)) {
                known.set(fact.key, fact);
                changed.set(fact.key, fact);
            }
        } catch (error) {
            if (segments.length === 1) throw error;
            const detail = error instanceof Error ? error.message : String(error);
            throw new Error(`第 ${index + 1}/${segments.length} 批总结失败：${detail}；本次原文和旧归档已保留`);
        }
    }
    const facts = [...changed.values()].sort((a, b) => a.sourceMessageId - b.sourceMessageId);
    const summary = [formatStoryArchiveFacts(facts, floorNumbers, Infinity, true), affinityLog.join('\n')].filter(Boolean).join('\n\n') || '本批无新增或变化';
    if (saveMaxChars > 0 && (facts.length || affinityLog.length) && storyArchiveCharacterCount(summary) > saveMaxChars) {
        throw new Error(`增量归档超过本剧情设置的 ${saveMaxChars} 字符保存上限；原文和旧归档已保留`);
    }
    return { facts, summary, affinityLog };
}

function archiveRows(rows: Message[], entryId: string, archive: StoryTheaterArchive): Message[] {
    const messages = storyArchiveFloors(rows, entryId)
        .filter(message => message.id >= archive.fromMessageId && message.id <= archive.toMessageId);
    if (!messages.length || messages.length !== archive.messageCount
        || messages[0].id !== archive.fromMessageId || messages[messages.length - 1].id !== archive.toMessageId) {
        throw new Error('这个事件盒的原文不完整，无法重新总结；旧摘要已保留');
    }
    return messages;
}

const sourceKey = (entry: StoryTheaterEntry, archive: StoryTheaterArchive) => JSON.stringify([
    entry.title, archive.id, archive.strategy, archive.summary, archive.fromMessageId, archive.toMessageId, archive.messageCount, archive.vectorMemoryIds, archive.facts, archive.affinityLog,
]);
const priorArchiveKey = (entry: StoryTheaterEntry, beforeId: number) => JSON.stringify(
    entry.archives.filter(box => box.toMessageId < beforeId).map(box => sourceKey(entry, box)),
);
const rowsKey = (messages: Message[]) => JSON.stringify(messages.map(message => [
    message.id, message.role, message.content, message.metadata?.theaterOpeningGreeting, message.metadata?.theaterContinue,
    storyArchiveAffinity(message),
]));

/**
 * Commit an automatic event box and all source-row archive flags atomically.
 * A failed story write must never leave hidden floors with no corresponding box,
 * and a failed row write must never leave a phantom box.
 */
export async function commitStoryArchiveBatch(
    snapshot: StoryTheaterEntry,
    batch: Message[],
    archive: StoryTheaterArchive,
): Promise<StoryTheaterEntry> {
    if (!batch.length || archive.messageCount !== batch.length
        || archive.fromMessageId !== batch[0].id || archive.toMessageId !== batch[batch.length - 1].id
        || archive.strategy !== snapshot.archiveStrategy) {
        throw new Error('剧情归档批次不完整，原文保持不变');
    }
    const db = await openDB();
    return new Promise<StoryTheaterEntry>((resolve, reject) => {
        const tx = db.transaction(['story_theaters', 'messages'], 'readwrite');
        const storyStore = tx.objectStore('story_theaters');
        const messageStore = tx.objectStore('messages');
        const storyRead = storyStore.get(snapshot.id);
        const reads = batch.map(message => messageStore.get(message.id));
        let pending = reads.length + 1;
        let updated: StoryTheaterEntry;
        let failure: unknown;
        tx.oncomplete = () => resolve(updated);
        tx.onerror = () => reject(failure || tx.error || new Error('剧情归档提交失败'));
        tx.onabort = () => reject(failure || tx.error || new Error('剧情归档未能完整提交，原文保留'));
        const finish = () => {
            if (--pending !== 0) return;
            try {
                const fresh = storyRead.result as StoryTheaterEntry | undefined;
                if (!fresh || fresh.updatedAt !== snapshot.updatedAt
                    || JSON.stringify(fresh.archives) !== JSON.stringify(snapshot.archives)) {
                    throw new Error('剧情在归档期间发生变化，未修改旧正文；请重新尝试');
                }
                for (const [index, request] of reads.entries()) {
                    const current = request.result as Message | undefined;
                    const expected = batch[index];
                    if (!current || current.charId !== storyTheaterThreadId(snapshot.id)
                        || current.metadata?.source !== 'story_theater'
                        || current.metadata.theaterId !== snapshot.id
                        || rowsKey([current]) !== rowsKey([expected])) {
                        throw new Error('剧情原文在归档期间发生变化，未修改旧正文；请重试');
                    }
                }
                if (fresh.archives.some(box => box.id === archive.id || overlapsArchive(archive.fromMessageId, archive.toMessageId, box))) {
                    throw new Error('归档范围与已有事件盒或向量归档重叠');
                }
                for (const request of reads) {
                    const message = request.result as Message;
                    messageStore.put({ ...message, metadata: {
                        ...message.metadata, theaterArchived: true, theaterArchiveStrategy: archive.strategy,
                    } });
                }
                updated = {
                    ...fresh, archives: [...fresh.archives, archive], updatedAt: Date.now(),
                };
                storyStore.put(updated);
            } catch (error) {
                failure = error;
                try { tx.abort(); } catch { /* transaction already aborted */ }
            }
        };
        storyRead.onsuccess = finish;
        for (const request of reads) request.onsuccess = finish;
    });
}

export async function regenerateStoryArchiveSummary(entryId: string, archiveId: string, api: Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>): Promise<StoryTheaterEntry> {
    return runStoryArchiveOperation(entryId, async () => {
        const entry = (await DB.getStoryTheaters()).find(item => item.id === entryId);
        const archive = entry?.archives.find(item => item.id === archiveId);
        if (!entry || !archive || archive.strategy !== 'summary') throw new Error('找不到剧情事件盒，请重新打开后重试');
        const rows = await DB.getMessagesByCharId(storyTheaterThreadId(entryId), true);
        const messages = archiveRows(rows, entryId, archive);
        const firstFloor = storyArchiveFloors(rows, entryId).findIndex(row => row.id === archive.fromMessageId) + 1;
        const archiveApi = resolveStoryMemoryApi(entry, api);
        const delta = await generateStoryArchiveDelta(entry, messages, archiveApi, firstFloor, 'summary');
        const db = await openDB();
        return await new Promise<StoryTheaterEntry>((resolve, reject) => {
            const tx = db.transaction(['story_theaters', 'messages'], 'readwrite');
            const store = tx.objectStore('story_theaters');
            const storyRead = store.get(entryId);
            const rowsRead = tx.objectStore('messages').index('charId').getAll(IDBKeyRange.only(storyTheaterThreadId(entryId)));
            let pending = 2, failure: unknown, updated: StoryTheaterEntry;
            tx.oncomplete = () => resolve(updated);
            tx.onerror = () => reject(failure || tx.error);
            tx.onabort = () => reject(failure || tx.error || new Error('重新总结未保存，旧摘要已保留'));
            const finish = () => {
                if (--pending) return;
                try {
                    const fresh = storyRead.result as StoryTheaterEntry | undefined;
                    const box = fresh?.archives.find(item => item.id === archiveId);
                    if (!fresh || !box || sourceKey(fresh, box) !== sourceKey(entry, archive)
                        || fresh.archiveSummaryGuideMaxChars !== entry.archiveSummaryGuideMaxChars
                        || priorArchiveKey(fresh, box.fromMessageId) !== priorArchiveKey(entry, archive.fromMessageId)
                        || rowsKey(archiveRows(rowsRead.result, entryId, box)) !== rowsKey(messages)) {
                        throw new Error('剧情事件盒或原文已变更，本次未保存；请重新打开后重试');
                    }
                    updated = { ...fresh, archives: fresh.archives.map(item => item.id === archiveId ? { ...item, ...delta } : item), updatedAt: Date.now() };
                    store.put(updated);
                } catch (error) { failure = error; tx.abort(); }
            };
            storyRead.onsuccess = finish;
            rowsRead.onsuccess = finish;
        });
    });
}

export function storyArchiveFloors(rows: Message[], entryId: string): Message[] {
    return rows.filter(row => row.charId === storyTheaterThreadId(entryId)
        && !row.groupId && row.metadata?.source === 'story_theater')
        .sort((a, b) => a.id - b.id);
}

const overlapsArchive = (first: number, last: number, box: StoryTheaterArchive) =>
    first <= box.toMessageId && box.fromMessageId <= last;

function updateFloorArchive(message: Message, archive?: StoryTheaterArchive): Message {
    const metadata = { ...message.metadata };
    if (archive) {
        metadata.theaterArchived = true;
        metadata.theaterArchiveStrategy = archive.strategy;
        delete metadata.theaterSkipAutoArchive;
    } else {
        delete metadata.theaterArchived;
        delete metadata.theaterArchiveStrategy;
        metadata.theaterSkipAutoArchive = true;
    }
    return { ...message, metadata };
}

/** Older versions stored vector nodes without assigning them to any individual range. */
export function storyArchiveReplacementSet(archives: StoryTheaterArchive[], target?: StoryTheaterArchive): StoryTheaterArchive[] {
    if (!target) return [];
    if (target.strategy === 'vector' && !target.vectorMemoryIds) {
        return archives.filter(box => box.strategy === 'vector' && !box.vectorMemoryIds);
    }
    return [target];
}

interface VectorArchiveOptions {
    embedding?: EmbeddingConfig;
    remote?: RemoteVectorConfig;
    fallbackApi?: Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>;
}
type VectorEntry = { node: MemoryNode; vector: MemoryVector };

function archiveEdit(
    entryId: string,
    strategy: StoryTheaterArchiveStrategy,
    change: (entry: StoryTheaterEntry, floors: Message[]) => {
        archives: StoryTheaterArchive[]; removed: StoryTheaterArchive[]; added?: StoryTheaterArchive; vectors?: VectorEntry[];
    },
    remote?: RemoteVectorConfig,
): Promise<StoryTheaterEntry> {
    const thread = storyTheaterThreadId(entryId);
    return openDB().then(db => new Promise<{ entry: StoryTheaterEntry; deleted: string[]; inserted: VectorEntry[] }>((resolve, reject) => {
        const vectorStores = strategy === 'vector' ? ['memory_nodes', 'memory_vectors', 'memory_links'] : [];
        const tx = db.transaction(['story_theaters', 'messages', ...vectorStores], 'readwrite');
        const stories = tx.objectStore('story_theaters');
        const messages = tx.objectStore('messages');
        const storyRead = stories.get(entryId);
        const rowsRead = messages.index('charId').getAll(IDBKeyRange.only(thread));
        const nodesRead = strategy === 'vector' ? tx.objectStore('memory_nodes').index('charId').getAll(thread) : undefined;
        const vectorsRead = strategy === 'vector' ? tx.objectStore('memory_vectors').index('charId').getAll(thread) : undefined;
        let pending = nodesRead ? 4 : 2, failure: unknown, updated: StoryTheaterEntry;
        let deleted: string[] = [], inserted: VectorEntry[] = [];
        tx.oncomplete = () => resolve({ entry: updated, deleted, inserted });
        tx.onabort = () => reject(failure ?? tx.error ?? new Error('归档未保存，旧摘要、向量与原文已保留'));
        const finish = () => {
            if (--pending) return;
            try {
                const entry = storyRead.result as StoryTheaterEntry | undefined;
                if (!entry) throw new Error('剧情已不存在');
                const floors = storyArchiveFloors(rowsRead.result, entryId);
                const { archives, removed, added, vectors = [] } = change(entry, floors);
                for (const row of floors) {
                    if ((added && overlapsArchive(row.id, row.id, added)) || removed.some(box => overlapsArchive(row.id, row.id, box))) {
                        messages.put(updateFloorArchive(row, storyArchiveAtFloor(archives, row.id)));
                    }
                }
                if (nodesRead && vectorsRead) {
                    const oldOwned = new Set(entry.archives.flatMap(box => box.vectorMemoryIds ?? []));
                    const removedOwned = new Set(removed.flatMap(box => box.vectorMemoryIds ?? []));
                    const removesLegacy = removed.some(box => !box.vectorMemoryIds);
                    const retained = new Set(archives.flatMap(box => box.vectorMemoryIds ?? []));
                    const nodeStore = tx.objectStore('memory_nodes');
                    const vectorStore = tx.objectStore('memory_vectors');
                    const links = tx.objectStore('memory_links');
                    const nodeIds = new Set((nodesRead.result as MemoryNode[]).map(node => node.id));
                    const vectorIds = new Set((vectorsRead.result as MemoryVector[]).map(vector => vector.memoryId));
                    const partitionIds = new Set([...nodeIds, ...vectorIds]);
                    deleted = [...partitionIds].filter(id => !retained.has(id)
                        && (removedOwned.has(id) || (removesLegacy && !oldOwned.has(id))));
                    for (const id of deleted) {
                        if (vectorIds.has(id)) vectorStore.delete(id);
                        if (!nodeIds.has(id)) continue;
                        nodeStore.delete(id);
                        for (const index of ['sourceId', 'targetId']) {
                            const cursor = links.index(index).openCursor(IDBKeyRange.only(id));
                            cursor.onsuccess = () => {
                                const row = cursor.result;
                                if (row) { row.delete(); row.continue(); }
                            };
                        }
                    }
                    for (const { node, vector } of vectors) {
                        const floats = ensureFloat32(vector.vector);
                        nodeStore.add(node);
                        vectorStore.add({ ...vector, vector: new Uint8Array(floats.buffer.slice(floats.byteOffset, floats.byteOffset + floats.byteLength)) });
                    }
                    inserted = vectors;
                }
                updated = { ...entry, archives, updatedAt: Date.now() };
                stories.put(updated);
            } catch (error) { failure = error; tx.abort(); }
        };
        for (const read of [storyRead, rowsRead, nodesRead, vectorsRead]) {
            if (read) read.onsuccess = finish;
        }
    })).then(({ entry, deleted, inserted }) => {
        for (const id of deleted) bm25Index.onNodeDeleted(id);
        if (inserted.length) bm25Index.onNodesSaved(inserted.map(item => item.node));
        if (deleted.length || inserted.length) notifyMemoryNodesChanged(thread);
        if (remote?.enabled && remote.initialized) {
            // Story recall only trusts the local owned set, even if cleanup fails.
            for (const id of deleted) void deleteVector(remote, id).catch(() => {});
        }
        return entry;
    });
}

/** Revoke a summary or a vector range, releasing its original floors atomically. */
export async function revokeStoryArchive(entryId: string, expected: StoryTheaterArchive, remote?: RemoteVectorConfig): Promise<StoryTheaterEntry> {
    return runStoryArchiveOperation(entryId, () => archiveEdit(entryId, expected.strategy, entry => {
        const box = entry.archives.find(item => item.id === expected.id);
        if (!box || sourceKey(entry, box) !== sourceKey(entry, expected)) throw new Error('归档已变更，请重新打开后再撤销');
        const removed = storyArchiveReplacementSet(entry.archives, box);
        return { archives: entry.archives.filter(item => !removed.includes(item)), removed };
    }, remote));
}

/** Automatic vector archiving already holds the story generation lock. */
export function archiveStoryVectorRangeInGeneration(
    entryId: string, selected: Message[], api: Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>,
    options: VectorArchiveOptions,
): Promise<StoryTheaterEntry> {
    return writeStoryArchiveRange(entryId, selected, api, undefined, options);
}

export function archiveStoryFloorRange(
    entryId: string, selected: Message[], api: Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>,
    replaceArchiveId?: string, vector?: VectorArchiveOptions,
): Promise<StoryTheaterEntry> {
    return runStoryArchiveOperation(entryId, () => writeStoryArchiveRange(entryId, selected, api, replaceArchiveId, vector));
}

async function writeStoryArchiveRange(
    entryId: string, selected: Message[], api: Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>,
    replaceArchiveId?: string, vector?: VectorArchiveOptions,
): Promise<StoryTheaterEntry> {
    const strategy = vector ? 'vector' : 'summary';
    const embedding = vector?.embedding;
    if (vector && (!embedding?.baseUrl || !embedding.apiKey || !embedding.model)) {
        throw new Error('请先配置向量记忆的 Embedding API');
    }
    const first = selected[0]?.id, last = selected.at(-1)?.id;
    if (first === undefined || last === undefined) throw new Error('请先选择要归档的楼层');
    const thread = storyTheaterThreadId(entryId);
    const validate = (entry: StoryTheaterEntry, floors: Message[]) => {
        const batch = floors.filter(row => row.id >= first && row.id <= last);
        if (rowsKey(batch) !== rowsKey(selected)) throw new Error('所选楼层已变更，请重新选择');
        const latest = floors.at(-1);
        if (latest?.role === 'user' && latest.id === last) throw new Error('最后一条推进还没有回复，请选它之前的楼层');
        const previous = entry.archives.find(box => box.id === replaceArchiveId);
        if (replaceArchiveId && previous?.strategy !== strategy) throw new Error('找不到要替换的归档');
        const removed = storyArchiveReplacementSet(entry.archives, previous);
        const others = entry.archives.filter(box => !removed.includes(box));
        if (others.some(box => overlapsArchive(first, last, box))) throw new Error('所选范围与其他归档重叠，请调整楼层');
        return { batch, previous, removed, others };
    };

    const entry = (await DB.getStoryTheaters()).find(item => item.id === entryId);
    if (!entry) throw new Error('剧情已不存在');
    const floors = storyArchiveFloors(await DB.getMessagesByCharId(thread, true), entryId);
    const initial = validate(entry, floors);
    const archiveApi = resolveStoryMemoryApi(entry, vector?.fallbackApi ?? api);
    const firstFloor = floors.findIndex(row => row.id === first) + 1;
    const delta = await generateStoryArchiveDelta({ ...entry, archives: initial.others }, initial.batch, archiveApi, firstFloor, strategy);
    const boxId = initial.previous?.id ?? makeStoryTheaterId();
    const factNodes = embedding ? delta.facts.map(fact => ({
        ...fact, vectorNodeId: makeStoryTheaterId(), vectorTextState: 'synced' as const,
    })) : undefined;
    const revisionKey = (snapshot: StoryTheaterEntry, boxes: StoryTheaterArchive[]) =>
        JSON.stringify(boxes.map(box => sourceKey(snapshot, box)));
    const commit = (vectors?: VectorEntry[]) => archiveEdit(entryId, strategy, (fresh, currentFloors) => {
        const { batch, previous, removed, others } = validate(fresh, currentFloors);
        if (fresh.title !== entry.title || revisionKey(entry, initial.removed) !== revisionKey(fresh, removed)
            || fresh.archiveSummaryGuideMaxChars !== entry.archiveSummaryGuideMaxChars
            || revisionKey(entry, initial.others.filter(box => box.toMessageId < first)) !== revisionKey(fresh, others.filter(box => box.toMessageId < first))) {
            throw new Error('归档在整理期间已变更，旧内容已保留');
        }
        const box: StoryTheaterArchive = {
            ...previous, id: boxId, strategy, fromMessageId: first, toMessageId: last,
            messageCount: batch.length, createdAt: previous?.createdAt ?? Date.now(),
            ...(vectors ? { vectorMemoryIds: vectors.map(item => item.node.id), summary: undefined } : { summary: delta.summary }),
            facts: factNodes ?? delta.facts, affinityLog: delta.affinityLog,
        };
        return { archives: [...others, box].sort((a, b) => a.fromMessageId - b.fromMessageId), removed, added: box, vectors };
    }, vector?.remote);

    if (!embedding) return commit();

    if (!factNodes?.length) return commit([]);
    if (factNodes.some(fact => fact.text.length > EMBEDDING_MAX_INPUT_CHARS)) {
        throw new Error('单条剧情事实超过向量容量，原文和旧归档已保留');
    }
    const now = Date.now();
    const nodes: MemoryNode[] = factNodes.map(fact => ({
        id: fact.vectorNodeId, content: fact.text, tags: ['剧情', ...fact.terms],
        charId: thread, room: 'living_room', importance: 6, mood: 'neutral',
        embedded: false, createdAt: now, lastAccessedAt: now, accessCount: 0,
    }));
    let updated: StoryTheaterEntry | undefined;
    await vectorizeAndStore(nodes, { ...embedding, requestPurpose: '剧情独立向量 · 归档建索引',
        allowSingleInputFallback: false,
    }, vector?.remote, {
        // Each batch owns its own nodes so undoing one cannot erase another.
        skipDedup: true,
        commit: async vectors => { updated = await commit(vectors); },
    });
    if (!updated) throw new Error('向量归档未保存');
    return updated;
}
