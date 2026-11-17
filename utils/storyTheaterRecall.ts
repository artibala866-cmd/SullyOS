import type { Message, StoryArchiveFact, StoryTheaterEntry } from '../types';
import type { EmbeddingConfig, MemoryNode } from './memoryPalace/types';
import { bm25Search } from './memoryPalace/bm25';
import { rerankDocuments, type RerankApiConfig } from './memoryPalace/rerank';
import {
    collectStoryArchiveFacts, filterStoryArchiveBaselineRepeats, findStoryArchiveEvidence, formatStoryArchiveActiveState,
    formatStoryArchiveFacts, formatStoryArchiveProseContext, formatStoryArchiveRecallTimeline, formatStoryArchiveScene,
    readStoryRecallArchives, reconcileStoryArchiveContinuity, selectExplicitStoryFacts, selectStoryArchiveTransitions,
    storyArchiveFactIdentity, storyArchiveNeedsRanking, storyArchiveQueryFloors, storyArchiveSearchTerms,
    storyArchiveSourceTimes, storyRecentSceneCue, storyRelatedArchiveFacts,
} from './storyArchiveFacts';
import {
    buildStoryArchiveMemoryEnvelope, selectStoryArchiveAuthorInstructions, selectStoryArchiveContext, storyTheaterThreadId,
    type StoryApiMessage,
} from './storyTheater';
import { loadStoryVectorRecall, selectStoryVectorRecall } from './storyTheaterVectorMemory';

export interface StoryRecallReceipt {
    floor: number;
    availableFacts: number;
    injectedFloors: number[];
    relatedFloors?: number[];
    missedFloors?: number[];
    archiveIds: string[];
    embeddingRequests: number;
    fallback: boolean;
    rerank?: 'used' | 'failed';
    routes?: number;
    facts?: { floor?: number; title: string; status: 'injected' | 'partial' | 'budget' | 'filtered' | 'turn' }[];
}

const receiptKey = (entryId: string) => 'sully_story_recall:' + entryId;

export function readStoryRecallHistory(entryId: string): StoryRecallReceipt[] {
    try {
        const stored: unknown = JSON.parse(localStorage.getItem(receiptKey(entryId)) || 'null');
        const items = Array.isArray(stored) ? stored : [stored];
        return items.filter((receipt): receipt is StoryRecallReceipt => !!receipt
            && Number.isFinite(receipt.floor) && Array.isArray(receipt.injectedFloors)
            && Array.isArray(receipt.archiveIds)).slice(0, 8);
    } catch { return []; }
}

export function readStoryRecallReceipt(entryId: string): StoryRecallReceipt | undefined {
    return readStoryRecallHistory(entryId)[0];
}

export function recordStoryRecallReceipt(entryId: string, receipt: StoryRecallReceipt): void {
    try { localStorage.setItem(receiptKey(entryId), JSON.stringify([receipt, ...readStoryRecallHistory(entryId)].slice(0, 8))); }
    catch { /* Diagnostics must not block the story request. */ }
}

function storyRecallFocus(userInput: string, prior: readonly string[]): string[] {
    const input = userInput.trim();
    if (!input) return [];
    const routes = input.split(/[？?；;\n]+/u).map(value => value.trim()).filter(value => value.length >= 2);
    const pointsBack = /(?:那(?:个|件|条|封|位)|此事|这(?:件|条|封)|前面|刚才|之前那个|其后|后来呢)/u.test(input);
    return [...new Set([...(pointsBack ? prior.slice(-1) : []), ...(routes.length > 1 ? routes.slice(0, 2) : []), input])].slice(-3);
}

export async function buildStoryTheaterRecall(input: {
    entry: StoryTheaterEntry;
    rows: Message[];
    beforeId: number;
    floor: number;
    baseline: string;
    visibleRows: Pick<Message, 'id' | 'role' | 'content'>[];
    historyVisible: boolean;
    continuation: boolean;
    opening: boolean;
    userInput: string;
    readOriginalEvidence: boolean;
    embedding?: EmbeddingConfig;
    rerank?: RerankApiConfig & { topN?: number };
}) {
    const { rows, beforeId, floor, baseline, visibleRows, historyVisible, continuation, opening, userInput, readOriginalEvidence } = input;
    const entry = { ...input.entry, archives: readStoryRecallArchives(input.entry.archives) };
    const vector = await loadStoryVectorRecall(entry, beforeId).catch(error => {
        console.warn('[StoryTheater] vector memory unavailable', error);
        return { nodes: [], groups: [], factNodes: [], factTextById: new Map<string, string>(), degraded: true };
    });
    const facts = collectStoryArchiveFacts(entry.archives, beforeId, vector.factTextById, true);
    const floorNumbers = new Map(rows.map((row, index) => [row.id, index + 1]));
    const sourceTimes = storyArchiveSourceTimes(readOriginalEvidence ? rows : visibleRows);
    const archiveEnd = entry.archives.reduce((end, box) => box.toMessageId < beforeId ? Math.max(end, box.toMessageId) : end, 0);
    const recentRows = archiveEnd > 0 && !historyVisible && !opening && readOriginalEvidence
        ? rows.filter(row => row.role === 'assistant' && row.id > archiveEnd && row.id < beforeId).slice(-2) : [];
    const reconciled = reconcileStoryArchiveContinuity(facts, entry.archives, beforeId,
        readOriginalEvidence ? rows : [], historyVisible ? visibleRows.slice(-4) : recentRows);
    const visibleFacts = filterStoryArchiveBaselineRepeats(reconciled.facts, entry.archives, baseline);
    const scene = historyVisible || opening ? { text: '', facts: [] } : formatStoryArchiveScene(visibleFacts, floorNumbers, sourceTimes);
    const legacyScene = historyVisible || opening || scene.text ? '' : [
        ...entry.archives.filter(box => box.strategy === 'summary' && box.toMessageId < beforeId && !box.facts && box.summary)
            .map(box => ({ end: box.toMessageId, text: box.summary! })),
        ...vector.groups.flatMap(group => group.archiveIds.map(id => ({
            end: entry.archives.find(box => box.id === id)?.toMessageId ?? 0,
            text: group.nodes.map(node => node.content).join('\n'),
        }))),
    ].sort((a, b) => b.end - a.end)[0]?.text.slice(-420) ?? '';
    const recentScene = storyRecentSceneCue(recentRows, floorNumbers);
    const clip = (text: string) => text.length <= 1800 ? text : text.slice(0, 900) + '\n' + text.slice(-900);
    const priorSignals = (historyVisible ? visibleRows.slice(continuation ? -3 : -2).map(row => clip(row.content))
        : [scene.text || legacyScene, recentScene]).map(text => text.trim()).filter(Boolean);
    const focus = continuation || opening ? [] : storyRecallFocus(clip(userInput), priorSignals);
    const signals = [...new Set([...priorSignals, ...focus])];
    const query = signals.join('\n');
    const active = formatStoryArchiveActiveState(reconciled.active, query, floorNumbers, sourceTimes);
    if (recentScene) {
        active.text = ['【较新的场景线索】\n' + recentScene, active.text].filter(Boolean).join('\n\n');
        active.cost += recentScene.length + 25;
    }
    if (scene.text) {
        active.text = [active.text, '【最近归档的场景与后续事项】\n' + scene.text].filter(Boolean).join('\n\n');
        active.cost += scene.text.length + 30;
        for (const fact of scene.facts) active.selected.add(storyArchiveFactIdentity(fact));
    }
    const useTimeline = entry.archives.some(box => box.strategy === 'vector' && box.facts && box.fromMessageId < beforeId);
    const rankable = visibleFacts.filter(fact => !active.selected.has(storyArchiveFactIdentity(fact)));
    const liveNodes = new Map(vector.factNodes.map(node => [node.id, node]));
    const candidates: MemoryNode[] = rankable.map(fact => liveNodes.get(fact.vectorNodeId ?? '') ?? {
        id: storyArchiveFactIdentity(fact), charId: storyTheaterThreadId(entry.id), content: fact.text,
        tags: storyArchiveSearchTerms(fact), room: 'living_room', mood: 'neutral', importance: 6,
        embedded: false, createdAt: 0, lastAccessedAt: 0, accessCount: 0,
    });
    const competing = storyArchiveNeedsRanking(rankable, floorNumbers, sourceTimes, useTimeline, active.cost);
    const selected = await selectStoryVectorRecall(vector, signals, input.embedding, candidates, competing);
    let rerank: StoryRecallReceipt['rerank'];
    if (competing && input.rerank?.baseUrl && input.rerank.apiKey && input.rerank.model && focus.length) {
        const pool = new Map<string, MemoryNode>();
        for (const signal of focus) {
            for (const hit of bm25Search(signal, candidates, 12)) pool.set(hit.node.id, hit.node);
        }
        for (const node of [...candidates].filter(node => selected.semanticFactRank.has(node.id))
            .sort((a, b) => selected.semanticFactRank.get(a.id)! - selected.semanticFactRank.get(b.id)!).slice(0, 12)) {
            pool.set(node.id, node);
        }
        const nodes = [...pool.values()].slice(0, 25);
        if (nodes.length >= 2) {
            try {
                const signal = AbortSignal.timeout(5000);
                const interrupted = new Promise<never>((_, reject) =>
                    signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
                const results = await Promise.race([interrupted, rerankDocuments({ ...input.rerank, signal },
                    focus.at(-1)!, nodes.map(node => node.content.slice(0, 1600)), Math.min(8, Math.max(1, input.rerank.topN || 5)))]);
                const ordered = [...new Set(results.map(result => nodes[result.index]?.id).filter((id): id is string => !!id))];
                if (!ordered.length) throw new Error('剧情重排未返回有效候选');
                ordered.forEach((id, index) => selected.semanticFactRank.set(id, index - ordered.length));
                rerank = 'used';
            } catch { rerank = 'failed'; }
        }
    }
    const explicitQuery = continuation || opening ? '' : userInput;
    const explicitFloors = storyArchiveQueryFloors(explicitQuery);
    const explicit = selectExplicitStoryFacts(visibleFacts, explicitQuery, floorNumbers, selected.semanticFactRank);
    const graphRank = selected.embeddingRequests > 0 && !selected.embeddingFailed ? selected.semanticFactRank : new Map<string, number>();
    const related = storyRelatedArchiveFacts(visibleFacts, continuation ? query : userInput, graphRank);
    const relatedKeys = new Set(related.map(fact => fact.key));
    const priority = new Map(selected.semanticFactRank);
    related.forEach((fact, index) => priority.set(fact.vectorNodeId ?? storyArchiveFactIdentity(fact), index - related.length));
    const past = selectStoryArchiveTransitions(entry.archives, beforeId, floorNumbers, sourceTimes, 700, query, baseline, useTimeline, relatedKeys, vector.factTextById, explicitFloors)
        .filter(fact => !reconciled.closedPlans.some(plan => plan.key === fact.key && plan.sourceMessageId === fact.sourceMessageId));
    const sent = new Map([...active.selected].map(id => [id, true]));
    const mark = (fact: StoryArchiveFact, complete: boolean) => {
        const id = storyArchiveFactIdentity(fact);
        sent.set(id, complete || sent.get(id) || false);
    };
    const timeline = useTimeline
        ? formatStoryArchiveRecallTimeline(visibleFacts, past, query, floorNumbers, priority, sourceTimes, active, relatedKeys, explicit, explicitFloors, mark) : '';
    const current = useTimeline ? '' : formatStoryArchiveProseContext(visibleFacts, query, floorNumbers, priority, sourceTimes, active, explicit, mark);
    const previous = useTimeline ? '' : formatStoryArchiveFacts(past, floorNumbers, Infinity, true, sourceTimes, mark);
    const legacyCandidates: MemoryNode[] = entry.archives.flatMap<MemoryNode>(box =>
        box.strategy === 'summary' && !box.facts && box.toMessageId < beforeId && box.summary?.trim() ? [{
            id: box.id, content: box.summary, charId: storyTheaterThreadId(entry.id), tags: [],
            room: 'living_room', mood: 'neutral', importance: 5, embedded: false,
            createdAt: box.toMessageId, lastAccessedAt: 0, accessCount: 0,
        }] : []);
    const relevantBoxes = query ? bm25Search(query, legacyCandidates, 3).map(hit => hit.node.id) : [];
    const boxes = selectStoryArchiveContext(entry.archives, beforeId, 6000, relevantBoxes);
    const summaries = boxes.map((box, index) => {
        const first = floorNumbers.get(box.fromMessageId), last = floorNumbers.get(box.toMessageId);
        return '事件盒 ' + (index + 1) + (first && last ? '（第 ' + first + '–' + last + ' 楼）' : '') + '：' + box.summary;
    }).join('\n\n');
    const relatedByFloor = new Map<number, string[]>();
    for (const fact of [...explicit, ...related, ...past.filter(fact => relatedKeys.has(fact.key))]) {
        const terms = storyArchiveSearchTerms(fact);
        if (terms.length) relatedByFloor.set(fact.sourceMessageId, [...new Set([...(relatedByFloor.get(fact.sourceMessageId) ?? []), ...terms])]);
    }
    const evidence = !opening && readOriginalEvidence ? findStoryArchiveEvidence(rows, entry.archives, beforeId,
        continuation ? query : signals.at(-1) ?? '',
        [summaries, timeline, current, previous, selected.text, baseline].join('\n'),
        baseline, floorNumbers, reconciled.closedPlans, relatedByFloor, explicitFloors) : '';
    const author = selectStoryArchiveAuthorInstructions(entry.archives, beforeId, boxes);
    const affinity = entry.archives.filter(box => box.toMessageId < beforeId && box.affinityLog?.length)
        .sort((a, b) => b.toMessageId - a.toMessageId).slice(0, 8).reverse()
        .map(box => box.affinityLog!.join('\n')).join('\n\n');
    const messages: StoryApiMessage[] = [
        ['### 常驻事件盒\n事件盒只记录已经发生的关键事件、关系变化、重要设定及未解决事项。后续状态以较新楼层和用户修正为准。', summaries],
        ['### 较早事件盒的用户协助指令（历史记录）\n若与较新的明确用户要求冲突，以较新的要求为准。', author],
        ['### 历史界面好感记录（已发生）', affinity],
        ['', buildStoryArchiveMemoryEnvelope(selected.text)],
        ['### 剧情经过（按楼层先后；以下为已被更新的旧状态）\n较新的状态、正文和用户修正优先。', previous],
        ['### 相关剧情原文摘录（历史资料）\n仅用于核对细节，可能包含旧状态、台词或未验证的说法。', evidence],
        ['### 剧情记忆时间线（按原剧情楼层排列）\n沿用当前设定和结案结果。角色只知道其实际可感知或已获知的事情。同楼事件的先后以原文为准。', timeline],
        ['### 本剧情目前已确认的状态（按楼层先后排列）\n角色只知道其实际可感知或已获知的事情。', current],
    ].flatMap(([title, content]) => content ? [{ role: 'system' as const, content: [title, content].filter(Boolean).join('\n') }] : []);
    const injectedFloors = [...new Set([...messages.map(message => message.content).join('\n').matchAll(/^\[第 (\d+) 楼/gmu)]
        .map(match => Number(match[1])))].sort((a, b) => a - b);
    const injectedIds = injectedFloors.map(number => rows[number - 1]?.id);
    const sourceArchives = entry.archives.filter(box => box.fromMessageId < beforeId
        && injectedIds.some(id => id !== undefined && box.fromMessageId <= id && id <= box.toMessageId));
    const injected = new Set(injectedFloors);
    const relatedFloors = [...new Set(related.flatMap(fact => {
        const number = floorNumbers.get(fact.sourceMessageId);
        return number !== undefined && injected.has(number) ? [number] : [];
    }))].sort((a, b) => a - b);
    const eligible = new Set([...visibleFacts, ...past].map(storyArchiveFactIdentity));
    const trace = [...new Map([...explicit, ...related, ...reconciled.active, ...visibleFacts, ...past, ...facts]
        .map(fact => [storyArchiveFactIdentity(fact), fact])).entries()].slice(0, 120)
        .map(([id, fact]): NonNullable<StoryRecallReceipt['facts']>[number] => ({
            floor: floorNumbers.get(fact.sourceMessageId),
            title: fact.text.replace(/\s+/g, ' ').slice(0, 72),
            status: sent.get(id) ? 'injected' : sent.has(id) ? 'partial' : fact.authorScope === 'turn' ? 'turn'
                : eligible.has(id) ? 'budget' : 'filtered',
        }));
    return {
        messages,
        receipt: {
            floor, availableFacts: facts.length, injectedFloors, relatedFloors,
            missedFloors: [...explicitFloors].filter(number => !injected.has(number)),
            archiveIds: [...new Set([...sourceArchives.map(box => box.id), ...boxes.map(box => box.id), ...selected.archiveIds])],
            facts: trace, routes: focus.length, rerank,
            embeddingRequests: selected.embeddingRequests, fallback: selected.embeddingFailed || vector.degraded,
        },
    };
}
