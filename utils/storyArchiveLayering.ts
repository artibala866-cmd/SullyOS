import type { StoryTheaterArchive } from '../types';

/**
 * A read-only view over the story's existing six-section event boxes.
 * No migration, rewriting, re-summary, persistence or secondary-API request.
 */
const HEADINGS = [
    '关键事件与因果',
    '时间地点与场景',
    '人物关系与转折',
    '好感与心理变化',
    '新增设定与细节',
    '未解决事项与续写落点',
] as const;
const ALWAYS_READ = new Set<number>([0, 2, 4, 5]);
const UNSPECIFIED = '原文未交代';
const COMMON = new Set([
    '我们', '你们', '他们', '她们', '自己', '一个', '这个', '那个', '什么', '怎么',
    '已经', '正在', '还是', '就是', '不是', '没有', '可以', '觉得', '知道',
    '因为', '所以', '然后', '之前', '后来', '现在', '这里', '那里', '时候',
    '对方', '角色', '剧情', '继续', '一下', '一直', '如果', '但是', '没有',
]);

type ArchiveRange = Pick<StoryTheaterArchive, 'id' | 'summary' | 'fromMessageId' | 'toMessageId'>;

export type LayeredStoryArchive = {
    archiveId: string;
    fromMessageId: number;
    toMessageId: number;
    tier: 'recent-full' | 'related-full' | 'long-term';
    text: string;
};

/** Strict legacy-safe parser: malformed or older free-form boxes are never partly discarded. */
export function readStoryArchiveSections(summary: string): string[] | null {
    const starts = [...summary.matchAll(/^【([^】]+)】[ \t]*\r?$/gm)];
    if (starts.length !== HEADINGS.length || starts[0]?.index !== 0) return null;
    if (starts.some((match, index) => match[1] !== HEADINGS[index])) return null;
    return starts.map((match, index) =>
        summary.slice((match.index ?? 0) + match[0].length, starts[index + 1]?.index).trim(),
    );
}

export function longTermStoryArchiveView(summary: string): string {
    const sections = readStoryArchiveSections(summary);
    if (!sections) return summary; // Old and imported boxes remain fully readable.
    return sections.map((body, index) => ALWAYS_READ.has(index) && body && body !== UNSPECIFIED
        ? '【' + HEADINGS[index] + '】\n' + body : '',
    ).filter(Boolean).join('\n\n') || summary;
}

function storyQueryKeywords(query: string): string[] {
    const words = query.slice(-1600).match(/[\u3400-\u9fff]{2,}\d{1,6}|[\u3400-\u9fff]{2,}|[A-Za-z][A-Za-z0-9_-]{3,}|\d{3,}/g) || [];
    const terms = new Set<string>();
    for (const word of words) {
        if (/^[\u3400-\u9fff]+$/.test(word)) {
            for (let index = 0; index + 2 <= word.length; index += 1) {
                const pair = word.slice(index, index + 2);
                if (!COMMON.has(pair)) terms.add(pair);
            }
        } else terms.add(word.toLowerCase());
    }
    return [...terms].slice(0, 160);
}

function relevanceScore(summary: string, keywords: string[]): number {
    if (keywords.length === 0) return 0;
    const body = summary.toLowerCase();
    let score = 0;
    for (const word of keywords) {
        if (/[\u3400-\u9fff]\d/.test(word)) {
            // "章节1" must not accidentally match "章节10".
            const escaped = word; // Words only contain Han characters and digits.
            if (new RegExp(escaped + '(?!\\d)').test(body)) score += 8;
        } else if (body.includes(word)) score++;
    }
    // One common Chinese bigram is not enough to recall an entire old event box.
    return score;
}

/**
 * Tier 1: two most recent boxes in full, preserving scene and emotional detail.
 * Tier 2: older relevant boxes in full (including time, feelings and UI affinity).
 * Tier 3: other earlier boxes' causal facts, relations, rules and open threads.
 *
 * All six original sections and archived floors stay untouched in IndexedDB.
 * No arbitrary sentence/field truncation: if a section cannot fit it remains stored,
 * and older boxes are skipped as whole views rather than corrupting facts.
 */
export function selectLayeredStoryArchiveContext(
    archives: readonly ArchiveRange[],
    beforeId: number,
    query: string,
    budget = 6000,
): LayeredStoryArchive[] {
    const eligible = archives
        .filter(box => box.toMessageId < beforeId && !!box.summary?.trim())
        .sort((a, b) => b.toMessageId - a.toMessageId);
    const keywords = storyQueryKeywords(query);
    const recent = eligible.slice(0, 2);
    const matching = eligible.slice(2)
        .map(box => ({ box, score: relevanceScore(box.summary || '', keywords) }))
        .filter(item => item.score >= 2)
        .sort((a, b) => b.score - a.score || b.box.toMessageId - a.box.toMessageId)
        .slice(0, 2)
        .map(item => item.box);
    const taken = new Set<string>();
    const picked: LayeredStoryArchive[] = [];
    let used = 0;
    const limit = Number.isFinite(budget) ? Math.max(1, budget) : 6000;
    const add = (box: ArchiveRange, tier: LayeredStoryArchive['tier']) => {
        if (taken.has(box.id)) return;
        const storedSummary = box.summary || '';
        const content = tier === 'long-term' ? longTermStoryArchiveView(storedSummary) : storedSummary;
        if (!content.trim()) return;
        const length = Array.from(content).length;
        if (picked.length > 0 && used + length > limit) return;
        // Preserve the latest box even for an over-budget legacy import.
        picked.push({ archiveId: box.id, fromMessageId: box.fromMessageId,
            toMessageId: box.toMessageId, tier, text: content });
        used += length;
        taken.add(box.id);
    };
    for (const box of recent) add(box, 'recent-full');
    for (const box of matching) add(box, 'related-full');
    for (const box of eligible.slice(2, 10)) add(box, 'long-term');
    return picked.sort((a, b) => a.toMessageId - b.toMessageId);
}

export function renderLayeredStoryArchiveContext(
    archives: LayeredStoryArchive[],
    floors: ReadonlyMap<number, number>,
): string {
    return archives.map((item, index) => {
        const first = floors.get(item.fromMessageId), last = floors.get(item.toMessageId);
        const range = first && last ? '（第 ' + first + '–' + last + ' 楼）' : '';
        const tier = item.tier === 'recent-full' ? '近期完整记忆'
            : item.tier === 'related-full' ? '相关往事完整记忆' : '长期关键事实';
        return tier + ' · 事件盒 ' + (index + 1) + range + '：\n' + item.text;
    }).join('\n\n');
}
