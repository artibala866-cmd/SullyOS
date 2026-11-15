import type { StoryArchiveFact, StoryTheaterEntry } from '../types';
import type { EmbeddingConfig, MemoryNode, RemoteVectorConfig } from './memoryPalace/types';
import { ensureFloat32, MemoryNodeDB, MemoryVectorDB } from './memoryPalace/db';
import { openDB } from './db';
import { notifyMemoryNodesChanged } from './memoryPalace/nodeChanges';
import { updateStoredMemoryNode } from './memoryPalace/vectorStore';
import { deleteVector as deleteRemoteVector } from './memoryPalace/supabaseVector';
import { bm25Index } from './memoryPalace/bm25Index';
import { hybridSearch } from './memoryPalace/hybridSearch';
import { EMBEDDING_MAX_INPUT_CHARS, getEmbeddings } from './memoryPalace/embedding';
import { bm25Search } from './memoryPalace/bm25';
import { runStoryArchiveOperation } from './storyTheaterBackground';
import { storyTheaterThreadId } from './storyTheater';
import { storyTimeFromSource } from './storyArchiveFacts';

function assertStoryPartition(entryId: string, node: MemoryNode | undefined): MemoryNode {
    if (!node) throw new Error('这条剧情记忆已经不存在了');
    if (node.charId !== storyTheaterThreadId(entryId)) {
        throw new Error('已阻止跨剧情分区操作');
    }
    return node;
}

export async function listStoryVectorMemories(entryId: string): Promise<MemoryNode[]> {
    const partitionId = storyTheaterThreadId(entryId);
    const nodes = await MemoryNodeDB.getByCharId(partitionId);
    return nodes
        .filter(node => node.charId === partitionId)
        .sort((a, b) => b.createdAt - a.createdAt);
}

async function readStoryVectorArchive(entryId: string): Promise<StoryTheaterEntry | undefined> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const request = db.transaction('story_theaters', 'readonly').objectStore('story_theaters').get(entryId);
        request.onsuccess = () => resolve(request.result as StoryTheaterEntry | undefined);
        request.onerror = () => reject(request.error);
    });
}

function changeOwnedStoryFact(
    store: IDBObjectStore, entry: StoryTheaterEntry | undefined, nodeId: string,
    change: (fact: StoryArchiveFact) => StoryArchiveFact,
) {
    if (!entry) return;
    let changed = false;
    const archives = entry.archives.map(box => {
        if (box.strategy !== 'vector' || !box.vectorMemoryIds?.includes(nodeId) || !box.facts?.some(fact => fact.vectorNodeId === nodeId)) return box;
        changed = true;
        return { ...box, facts: box.facts.map(fact => fact.vectorNodeId === nodeId ? change(fact) : fact) };
    });
    if (changed) store.put({ ...entry, archives, updatedAt: Date.now() });
}

/** Read visible nodes and use the synced archive text if its node is unavailable. */
export async function loadStoryVectorRecall(entry: StoryTheaterEntry, beforeId: number) {
    const archives = entry.archives.filter(box => box.strategy === 'vector');
    const groups: { archiveIds: string[]; nodes: MemoryNode[] }[] = [];
    const factTextById = new Map<string, string>();
    if (!archives.length) return { nodes: [], groups, factTextById, factNodes: [] };
    const owned = new Set(archives.flatMap(box => box.vectorMemoryIds ?? []));
    const legacy = archives.filter(box => !box.vectorMemoryIds);
    const visibleFacts = archives
        .filter(box => box.toMessageId < beforeId)
        .flatMap(box => (box.facts ?? []).filter(fact => fact.vectorNodeId && box.vectorMemoryIds?.includes(fact.vectorNodeId)));
    const visibleNodeIds = [...new Set(visibleFacts.map(fact => fact.vectorNodeId!))];
    const all = await listStoryVectorMemories(entry.id).catch(async error => {
        console.warn('[StoryTheater] vector partition read failed; recovering by node ID', error);
        const ids = [...new Set([...visibleNodeIds, ...archives.filter(box => box.toMessageId < beforeId)
            .flatMap(box => box.vectorMemoryIds ?? [])])];
        const reads = await Promise.allSettled(ids.map(id => MemoryNodeDB.getById(id)));
        return reads.flatMap(result => result.status === 'fulfilled' && result.value?.charId === storyTheaterThreadId(entry.id)
            ? [result.value] : []);
    });
    const liveNodes = all.filter(node => !node.archived && node.content.trim());
    const byId = new Map(liveNodes.map(node => [node.id, node]));
    for (const id of visibleNodeIds) {
        const node = byId.get(id);
        if (node) factTextById.set(id, node.content);
    }

    const present = new Set(all.map(node => node.id));
    const missingIds = new Set(visibleNodeIds.filter(id => !present.has(id)));
    if (missingIds.size) {
        try {
            // Use the current saved archive so an older open tab cannot revive a deleted or edited fact.
            const saved = await readStoryVectorArchive(entry.id);
            for (const box of saved?.archives ?? []) {
                if (box.strategy !== 'vector' || box.toMessageId >= beforeId) continue;
                for (const fact of box.facts ?? []) {
                    const id = fact.vectorNodeId;
                    if (id && missingIds.has(id) && box.vectorMemoryIds?.includes(id)
                        && fact.vectorTextState === 'synced' && fact.text.trim()) factTextById.set(id, fact.text);
                }
            }
        } catch (error) {
            console.warn('[StoryTheater] could not verify archived vector text', error);
        }
    }
    const legacyNodes = legacy.length && legacy.every(box => box.toMessageId < beforeId)
        ? liveNodes.filter(node => !owned.has(node.id)) : [];
    if (legacyNodes.length) {
        const ids = legacy.map(box => box.id);
        groups.push({ archiveIds: ids, nodes: legacyNodes });
    }
    for (const box of archives) {
        if (box.facts || box.toMessageId >= beforeId || !box.vectorMemoryIds?.length
            || !box.vectorMemoryIds.every(id => byId.has(id))) continue;
        const nodes = box.vectorMemoryIds.flatMap(id => {
            const node = byId.get(id);
            return node ? [node] : [];
        });
        groups.push({ archiveIds: [box.id], nodes });
    }
    const eligibleIds = new Set(groups.flatMap(group => group.nodes.map(node => node.id)));
    return { nodes: liveNodes.filter(node => eligibleIds.has(node.id)), groups, factTextById, factNodes: liveNodes.filter(node => factTextById.has(node.id)) };
}

/**
 * Story-local Memory Palace-style retrieval:
 * - keep ALL verified memories in prose when they fit the context budget;
 * - only search when the archive overflows (no unnecessary embedding bill);
 * - search recent turns independently, sharing ONE batched embedding request;
 * - merge hybrid vector/BM25 hits and use local BM25 on API failure;
 * - never return memories from another story's private vector partition.
 */
export async function selectStoryVectorRecall(
    { nodes, groups }: Pick<Awaited<ReturnType<typeof loadStoryVectorRecall>>, 'nodes' | 'groups'>,
    query: string | readonly string[],
    embedding?: EmbeddingConfig,
    currentFactNodes: MemoryNode[] = [],
): Promise<{ text: string; archiveIds: Set<string>; semanticFactRank: Map<string, number> }> {
    const archiveIds = new Set<string>();
    const semanticFactRank = new Map<string, number>();
    const limit = 6000;
    const separator = '\n\n';
    const candidates = groups.map(group => ({
        ...group,
        text: group.nodes.map(node => node.content).join(group.archiveIds.length === 1 ? '' : separator),
    }));
    const allText = candidates.map(group => group.text).join(separator);
    const needsLegacyRanking = allText.length > limit;
    const needsFactRanking = currentFactNodes.reduce((size, node) => size + node.content.length + 1, 0) > limit;
    if (!needsLegacyRanking && !needsFactRanking) {
        return { text: allText, archiveIds: new Set(candidates.flatMap(group => group.archiveIds)), semanticFactRank };
    }
    const queries = [...new Set((typeof query === 'string' ? [query] : query)
        .map(text => text.trim().slice(-2000)).filter(text => text.length >= 2))].slice(-3);
    const searchNodes = [
        ...(needsLegacyRanking ? nodes : []),
        ...(needsFactRanking ? currentFactNodes : []),
    ].filter(node => node.content.trim() && !node.archived);
    const ids = new Set(searchNodes.map(node => node.id));
    const factIds = new Set(currentFactNodes.map(node => node.id));
    const relevance = new Map<string, number>();

    if (searchNodes.length && queries.length) {
        // Works without an embedding API, and is the fallback if the network is down.
        const local = queries.flatMap(text => bm25Search(text, searchNodes, 20));
        for (const item of local) relevance.set(item.node.id, Math.max(relevance.get(item.node.id) ?? 0, item.score));

        if (embedding?.baseUrl && embedding.apiKey && embedding.model) {
            try {
                const charId = searchNodes[0].charId;
                const allVectors = (await MemoryVectorDB.getAllByCharId(charId))
                    .filter(vector => ids.has(vector.memoryId));
                if (allVectors.length) {
                    // Palace retrieves several meaningful message spikes with one
                    // batched embedding call, instead of diluting them into one query.
                    const recallConfig = { ...embedding, requestPurpose: '剧情独立向量 · 续写召回' };
                    const queryVectors = await getEmbeddings(queries, recallConfig);
                    bm25Index.ensureBuilt(charId, await MemoryNodeDB.getByCharId(charId));
                    const paths = await Promise.all(queries.map((text, i) =>
                        hybridSearch(text, charId, recallConfig, 20, undefined, {
                            queryVector: queryVectors[i], allNodes: searchNodes, allVectors,
                        })));
                    // Hybrid scores and local BM25 are different scales; a hybrid
                    // hit takes precedence, with local lexical matches as fallback.
                    const hybridScores = new Map<string, number>();
                    for (const matches of paths) {
                        for (const item of matches) {
                            hybridScores.set(item.node.id, Math.max(hybridScores.get(item.node.id) ?? -Infinity, item.finalScore));
                        }
                    }
                    if (hybridScores.size) {
                        for (const id of [...relevance.keys()]) relevance.set(id, -1000 + relevance.get(id)!);
                        for (const [id, score] of hybridScores) relevance.set(id, 1000 + score);
                    }
                }
            } catch (error) {
                console.warn('[StoryTheater] semantic recall failed; using local BM25', error);
            }
        }
    }

    const orderedHits = [...relevance].sort((a, b) => b[1] - a[1])
        .map(([id]) => id);
    const rank = new Map(orderedHits.map((id, index) => [id, index]));
    for (const id of orderedHits) if (factIds.has(id)) semanticFactRank.set(id, rank.get(id)!);
    const priority = candidates.map(group => ({
        ...group,
        rank: Math.min(...group.nodes.map(node => rank.get(node.id) ?? Infinity)),
    })).sort((a, b) => a.rank - b.rank);
    let text = '';
    for (const group of priority) {
        const combined = text ? text + separator + group.text : group.text;
        if (text && combined.length > limit) continue;
        text = combined;
        for (const id of group.archiveIds) archiveIds.add(id);
    }
    return { text, archiveIds, semanticFactRank };
}

export async function updateStoryVectorMemory(
    entryId: string,
    nodeId: string,
    content: string,
    embeddingConfig?: EmbeddingConfig,
    remoteVectorConfig?: RemoteVectorConfig,
): Promise<MemoryNode> {
    return runStoryArchiveOperation(entryId, async () => {
        const previous = assertStoryPartition(entryId, await MemoryNodeDB.getById(nodeId));
        const text = content.trim();
        if (text.length > EMBEDDING_MAX_INPUT_CHARS) throw new Error('记忆正文超过单条向量容量，旧内容已保留');
        const config = embeddingConfig && { ...embeddingConfig, requestPurpose: '剧情独立向量 · 编辑后建索引' };
        const result = await updateStoredMemoryNode(nodeId, { content: text }, config, remoteVectorConfig, async entries => {
            const db = await openDB();
            await new Promise<void>((resolve, reject) => {
                const tx = db.transaction(['story_theaters', 'memory_nodes', 'memory_vectors'], 'readwrite');
                const stories = tx.objectStore('story_theaters');
                const nodes = tx.objectStore('memory_nodes');
                const vectors = tx.objectStore('memory_vectors');
                const story = stories.get(entryId);
                const node = nodes.get(nodeId);
                let pending = 2;
                let failure: unknown;
                tx.oncomplete = () => resolve();
                tx.onabort = () => reject(failure ?? tx.error ?? new Error('剧情记忆编辑已回滚'));
                const finish = () => {
                    if (--pending) return;
                    try {
                        const current = assertStoryPartition(entryId, node.result as MemoryNode | undefined);
                        if (current.content !== previous.content) throw new Error('剧情记忆已变更，请重新打开后编辑');
                        changeOwnedStoryFact(stories, story.result, nodeId, fact => ({ ...fact, text, storyTime: storyTimeFromSource(text), vectorTextState: 'synced' }));
                        for (const { node: next, vector } of entries) {
                            const floats = ensureFloat32(vector.vector);
                            nodes.put(next);
                            vectors.put({ ...vector, vector: new Uint8Array(floats.buffer.slice(floats.byteOffset, floats.byteOffset + floats.byteLength)) });
                        }
                    } catch (error) { failure = error; tx.abort(); }
                };
                story.onsuccess = finish;
                node.onsuccess = finish;
            });
            bm25Index.onNodesSaved(entries.map(entry => entry.node));
            notifyMemoryNodesChanged(storyTheaterThreadId(entryId));
        });
        return assertStoryPartition(entryId, result.node);
    });
}

export async function deleteStoryVectorMemory(
    entryId: string,
    nodeId: string,
    remoteVectorConfig?: RemoteVectorConfig,
): Promise<{ remoteDeleted: boolean | null }> {
    // Deleting text, embedding and links in separate transactions can leave a
    // half-deleted memory when the browser quota or a tab fails mid-operation.
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['story_theaters', 'memory_nodes', 'memory_vectors', 'memory_links'], 'readwrite');
        const nodes = tx.objectStore('memory_nodes');
        const vectors = tx.objectStore('memory_vectors');
        const links = tx.objectStore('memory_links');
        const stories = tx.objectStore('story_theaters');
        const story = stories.get(entryId);
        const read = nodes.get(nodeId);
        let pending = 2;
        let failure: unknown;
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(failure ?? tx.error ?? new Error('删除剧情记忆失败'));
        tx.onabort = () => reject(failure ?? tx.error ?? new Error('删除剧情记忆已回滚'));
        const finish = () => {
            if (--pending) return;
            try {
                assertStoryPartition(entryId, read.result as MemoryNode | undefined);
                changeOwnedStoryFact(stories, story.result, nodeId, fact => ({ ...fact, text: '', vectorTextState: 'deleted' }));
                vectors.delete(nodeId);
                nodes.delete(nodeId);
                for (const indexName of ['sourceId', 'targetId']) {
                    const cursorRequest = links.index(indexName).openCursor(IDBKeyRange.only(nodeId));
                    cursorRequest.onsuccess = () => {
                        const cursor = cursorRequest.result;
                        if (cursor) {
                            cursor.delete();
                            cursor.continue();
                        }
                    };
                }
            } catch (error) {
                failure = error;
                tx.abort();
            }
        };
        read.onsuccess = finish;
        story.onsuccess = finish;
    });
    bm25Index.onNodeDeleted(nodeId);
    notifyMemoryNodesChanged(storyTheaterThreadId(entryId));

    if (!remoteVectorConfig?.enabled || !remoteVectorConfig.initialized) {
        return { remoteDeleted: null };
    }
    return { remoteDeleted: await deleteRemoteVector(remoteVectorConfig, nodeId) };
}
