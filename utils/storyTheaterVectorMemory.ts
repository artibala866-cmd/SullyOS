import type { StoryTheaterEntry } from '../types';
import type { EmbeddingConfig, MemoryNode, RemoteVectorConfig } from './memoryPalace/types';
import { MemoryNodeDB, MemoryVectorDB } from './memoryPalace/db';
import { openDB } from './db';
import { notifyMemoryNodesChanged } from './memoryPalace/nodeChanges';
import { updateStoredMemoryNode } from './memoryPalace/vectorStore';
import { deleteVector as deleteRemoteVector } from './memoryPalace/supabaseVector';
import { bm25Index } from './memoryPalace/bm25Index';
import { hybridSearch } from './memoryPalace/hybridSearch';
import { EMBEDDING_MAX_INPUT_CHARS } from './memoryPalace/embedding';
import { runStoryArchiveOperation } from './storyTheaterBackground';
import { storyTheaterThreadId } from './storyTheater';

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

/** Only local nodes still owned by a visible range can participate in this turn. */
export async function loadStoryVectorRecall(entry: StoryTheaterEntry, beforeId: number) {
    const archives = entry.archives.filter(box => box.strategy === 'vector');
    const groups: { archiveIds: string[]; nodes: MemoryNode[] }[] = [];
    if (!archives.length) return { nodes: [], groups };
    const owned = new Set(archives.flatMap(box => box.vectorMemoryIds ?? []));
    const legacy = archives.filter(box => !box.vectorMemoryIds);
    const all = (await listStoryVectorMemories(entry.id)).filter(node => !node.archived && node.content.trim());
    const available = new Set(all.map(node => node.id));
    const legacyNodes = legacy.length && legacy.every(box => box.toMessageId < beforeId)
        ? all.filter(node => !owned.has(node.id)) : [];
    if (legacyNodes.length) {
        const ids = legacy.map(box => box.id);
        groups.push({ archiveIds: ids, nodes: legacyNodes });
    }
    const byId = new Map(all.map(node => [node.id, node]));
    for (const box of archives) {
        if (box.toMessageId >= beforeId || !box.vectorMemoryIds?.some(id => available.has(id))) continue;
        const nodes = box.vectorMemoryIds.flatMap(id => {
            const node = byId.get(id);
            return node ? [node] : [];
        });
        groups.push({ archiveIds: [box.id], nodes });
    }
    const eligibleIds = new Set(groups.flatMap(group => group.nodes.map(node => node.id)));
    return { nodes: all.filter(node => eligibleIds.has(node.id)), groups };
}

export async function selectStoryVectorRecall(
    { nodes, groups }: Awaited<ReturnType<typeof loadStoryVectorRecall>>,
    query: string,
    embedding?: EmbeddingConfig,
): Promise<{ text: string; archiveIds: Set<string> }> {
    const archiveIds = new Set<string>();
    if (!nodes.length) return { text: '', archiveIds };
    const limit = 6000;
    const separator = '\n\n';
    const candidates = groups.map(group => ({
        ...group,
        text: group.nodes.map(node => node.content).join(separator),
    })).filter(group => group.text.length <= limit);
    const allText = candidates.map(group => group.text).join(separator);
    if (allText.length <= limit) {
        return { text: allText, archiveIds: new Set(candidates.flatMap(group => group.archiveIds)) };
    }
    let ordered = nodes;
    if (embedding?.baseUrl && embedding.apiKey && embedding.model && query.trim()) {
        try {
            const charId = nodes[0].charId;
            const ids = new Set(candidates.flatMap(group => group.nodes.map(node => node.id)));
            const allVectors = (await MemoryVectorDB.getAllByCharId(charId)).filter(vector => ids.has(vector.memoryId));
            if (allVectors.length) {
                bm25Index.ensureBuilt(charId, await MemoryNodeDB.getByCharId(charId));
                const recallConfig = { ...embedding, requestPurpose: '剧情独立向量 · 续写召回' };
                const matches = await hybridSearch(query, charId, recallConfig, 10, undefined, {
                    allNodes: nodes.filter(node => ids.has(node.id)), allVectors,
                });
                const rank = new Map(matches.map((match, index) => [match.node.id, index]));
                ordered = [...nodes].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
            }
        } catch (error) {
            console.warn('[StoryTheater] vector recall fell back to saved text', error);
        }
    }
    const rank = new Map(ordered.map((node, index) => [node.id, index]));
    const priority = candidates.map(group => ({
        ...group,
        rank: Math.min(...group.nodes.map(node => rank.get(node.id) ?? Infinity)),
    })).sort((a, b) => a.rank - b.rank);
    let text = '';
    for (const group of priority) {
        const combined = text ? text + separator + group.text : group.text;
        // A range can replace its original floors only if every selected section fits.
        if (combined.length > limit) continue;
        text = combined;
        for (const id of group.archiveIds) archiveIds.add(id);
    }
    return { text, archiveIds };
}

export async function updateStoryVectorMemory(
    entryId: string,
    nodeId: string,
    content: string,
    embeddingConfig?: EmbeddingConfig,
    remoteVectorConfig?: RemoteVectorConfig,
): Promise<MemoryNode> {
    return runStoryArchiveOperation(entryId, async () => {
        assertStoryPartition(entryId, await MemoryNodeDB.getById(nodeId));
        const text = content.trim();
        if (text.length > EMBEDDING_MAX_INPUT_CHARS) throw new Error('记忆正文超过单条向量容量，旧内容已保留');
        const config = embeddingConfig && { ...embeddingConfig, requestPurpose: '剧情独立向量 · 编辑后建索引' };
        const result = await updateStoredMemoryNode(nodeId, { content: text }, config, remoteVectorConfig);
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
        const tx = db.transaction(['memory_nodes', 'memory_vectors', 'memory_links'], 'readwrite');
        const nodes = tx.objectStore('memory_nodes');
        const vectors = tx.objectStore('memory_vectors');
        const links = tx.objectStore('memory_links');
        const read = nodes.get(nodeId);
        let failure: unknown;
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(failure ?? tx.error ?? new Error('删除剧情记忆失败'));
        tx.onabort = () => reject(failure ?? tx.error ?? new Error('删除剧情记忆已回滚'));
        read.onsuccess = () => {
            try {
                assertStoryPartition(entryId, read.result as MemoryNode | undefined);
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
    });
    bm25Index.onNodeDeleted(nodeId);
    notifyMemoryNodesChanged(storyTheaterThreadId(entryId));

    if (!remoteVectorConfig?.enabled || !remoteVectorConfig.initialized) {
        return { remoteDeleted: null };
    }
    return { remoteDeleted: await deleteRemoteVector(remoteVectorConfig, nodeId) };
}
