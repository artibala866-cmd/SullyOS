import { describe, expect, it } from 'vitest';
import type { StoryTheaterArchive } from '../types';
import { createStoryTheaterDraft, normalizeStoryTheater, selectStoryArchiveContext } from './storyTheater';

const box = (index: number, summary = '剧情事实'): StoryTheaterArchive => ({
    id: `box-${index}`, strategy: 'summary', fromMessageId: index * 2 - 1,
    toMessageId: index * 2, messageCount: 2, summary, createdAt: index,
});

describe('剧情分页与归档上下文边界', () => {
    it('新剧情默认一次20层，旧剧情保留兼容默认值与合理限制', () => {
        expect(createStoryTheaterDraft(1).readingBatchSize).toBe(20);
        expect(normalizeStoryTheater({ ...createStoryTheaterDraft(1), readingBatchSize: undefined }).readingBatchSize).toBe(20);
        expect(normalizeStoryTheater({ ...createStoryTheaterDraft(1), readingBatchSize: 150 }).readingBatchSize).toBe(100);
        expect(normalizeStoryTheater({ ...createStoryTheaterDraft(1), readingBatchSize: 10 }).readingBatchSize).toBe(10);
    });

    it('只自动带入最近有限事件盒，原存档保持完整且不改动顺序', () => {
        const archives = Array.from({ length: 30 }, (_, i) => box(i + 1));
        const selected = selectStoryArchiveContext(archives, Number.POSITIVE_INFINITY);
        expect(selected.map(x => x.id)).toEqual(archives.slice(-8).map(x => x.id));
        expect(archives).toHaveLength(30);
        expect(selected.map(x => x.toMessageId)).toEqual([...selected.map(x => x.toMessageId)].sort((a, b) => a - b));
    });

    it('预算不足只留最近盒且不剪断摘要，未来档案不越过当前续写位置', () => {
        const archives = [
            box(1, '旧'.repeat(1700)),
            box(2, '中'.repeat(1700)),
            box(3, '新'.repeat(1700)),
            box(4, '未来事件'),
        ];
        expect(selectStoryArchiveContext(archives, 7, 2500).map(x => x.id)).toEqual(['box-3']);
        expect(selectStoryArchiveContext(archives, 7, 2500)[0].summary).toBe('新'.repeat(1700));
    });
});
