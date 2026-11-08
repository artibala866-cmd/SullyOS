import type { StoryTheaterEntry } from '../types';
import type { EmbeddingConfig, MemoryNode, RemoteVectorConfig } from './memoryPalace/types';
import { MemoryLinkDB, MemoryNodeDB, MemoryVectorDB } from './memoryPalace/db';
import { updateStoredMemoryNode } from './memoryPalace/vectorStore';
import { deleteVector as deleteRemoteVector } from './memoryPalace/supabaseVector';
import { bm25Index } from './memoryPalace/bm25Index';
import { hybridSearch } from './memoryPalace/hybridSearch';
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
    const archiveIds = new Set<string>();
    if (!archives.length) return { nodes: [], archiveIds };
    const owned = new Set(archives.flatMap(box => box.vectorMemoryIds ?? []));
    const legacy = archives.filter(box => !box.vectorMemoryIds);
    const all = (await listStoryVectorMemories(entry.id)).filter(node => !node.archived && node.content.trim());
    const available = new Set(all.map(node => node.id));
    const legacyNodes = legacy.length && legacy.every(box => box.toMessageId < beforeId)
        ? all.filter(node => !owned.has(node.id)) : [];
    if (legacyNodes.length) for (const box of legacy) archiveIds.add(box.id);
    const eligibleIds = new Set(legacyNodes.map(node => node.id));
    for (const box of archives) {
        if (box.toMessageId >= beforeId || !box.vectorMemoryIds?.some(id => available.has(id))) continue;
        archiveIds.add(box.id);
        for (const id of box.vectorMemoryIds) eligibleIds.add(id);
    }
    return { nodes: all.filter(node => eligibleIds.has(node.id)), archiveIds };
}

export async function formatStoryVectorRecall(nodes: MemoryNode[], query: string, embedding?: EmbeddingConfig): Promise<string> {
    if (!nodes.length) return '';
    let ordered = nodes;
    if (embedding?.baseUrl && embedding.apiKey && embedding.model && query.trim()) {
        try {
            const charId = nodes[0].charId;
            const ids = new Set(nodes.map(node => node.id));
            const allVectors = (await MemoryVectorDB.getAllByCharId(charId)).filter(vector => ids.has(vector.memoryId));
            if (allVectors.length) {
                bm25Index.ensureBuilt(charId, await MemoryNodeDB.getByCharId(charId));
                const matches = await hybridSearch(query, charId, embedding, 10, undefined, { allNodes: nodes, allVectors });
                const rank = new Map(matches.map((match, index) => [match.node.id, index]));
                ordered = [...nodes].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
            }
        } catch (error) {
            console.warn('[StoryTheater] vector recall fell back to saved text', error);
        }
    }
    return ordered.slice(0, 10).map(node => node.content).join('\n\n').slice(0, 6000);
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
        const result = await updateStoredMemoryNode(nodeId, { content: content.trim() }, embeddingConfig, remoteVectorConfig);
        return assertStoryPartition(entryId, result.node);
    });
}

export async function deleteStoryVectorMemory(
    entryId: string,
    nodeId: string,
    remoteVectorConfig?: RemoteVectorConfig,
): Promise<{ remoteDeleted: boolean | null }> {
    assertStoryPartition(entryId, await MemoryNodeDB.getById(nodeId));
    const links = await MemoryLinkDB.getByNodeId(nodeId);
    await Promise.all([
        ...links.map(link => MemoryLinkDB.delete(link.id)),
        MemoryVectorDB.delete(nodeId),
        MemoryNodeDB.delete(nodeId),
    ]);

    if (!remoteVectorConfig?.enabled || !remoteVectorConfig.initialized) {
        return { remoteDeleted: null };
    }
    return { remoteDeleted: await deleteRemoteVector(remoteVectorConfig, nodeId) };
}
