import { describe, expect, it } from 'vitest';
import type { StoryTheaterArchive } from '../types';
import { createStoryTheaterDraft, normalizeStoryTheater, selectStoryArchiveAuthorInstructions, selectStoryArchiveContext } from './storyTheater';

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

    it('older author corrections remain available after their old event box leaves the eight-box window', () => {
        const oldText = '【关键事件与因果】\n两人第一次见面。\n\n【未解决事项与续写落点】\n已处理旧事；用户协助指令：不要替小雨决定是否离开。';
        const archives = Array.from({ length: 11 }, (_, i) => box(i + 1, i === 0 ? oldText : '普通剧情事实 ' + i));
        const recent = selectStoryArchiveContext(archives, Infinity);
        expect(recent).toHaveLength(8);
        expect(recent.map(item => item.id)).not.toContain('box-1');
        const authorNotes = selectStoryArchiveAuthorInstructions(archives, Infinity, recent);
        expect(authorNotes).toBe('用户协助指令：不要替小雨决定是否离开。');
        expect(authorNotes).not.toContain('两人第一次见面');
        expect(selectStoryArchiveAuthorInstructions(archives, 2, [], 1600)).toBe('');
    });

    it('does not repeat recent-box notes or cut oversized old instructions in half', () => {
        const early = box(1, '【未解决事项与续写落点】\n用户协助指令：' + '不得擅自推进'.repeat(100));
        const recent = box(2, '【未解决事项与续写落点】\n用户协助指令：角色必须遵守对话设定。');
        expect(selectStoryArchiveAuthorInstructions([early, recent], Infinity, [recent], 80)).toBe('');
        expect(selectStoryArchiveAuthorInstructions([early, recent], Infinity, [recent], 2000))
            .toContain('用户协助指令：不得擅自推进');
        expect(selectStoryArchiveAuthorInstructions([early, recent], Infinity, [recent], 2000))
            .not.toContain('角色必须遵守对话设定');
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
