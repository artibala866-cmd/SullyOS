import { describe, expect, it } from 'vitest';
import { longTermStoryArchiveView, readStoryArchiveSections, renderLayeredStoryArchiveContext, selectLayeredStoryArchiveContext } from './storyArchiveLayering';

const headings = [
    '关键事件与因果', '时间地点与场景', '人物关系与转折',
    '好感与心理变化', '新增设定与细节', '未解决事项与续写落点',
];
const makeSummary = (tag: string, override: Record<string, string> = {}) =>
    headings.map((name, index) => '【' + name + '】\n' + (override[name] ??
        [tag + '答应保守秘密，但仍未履行。', tag + '的旧场景在雨夜车站。',
        tag + '与阿泽关系仍然紧张。', tag + '害怕阿泽离开，阿泽并不知情。',
        tag + '的银色钥匙仍由小雨保管。', '用户协助指令：保留' + tag + '的独立决定；承诺仍未履行。'][index])).join('\n\n');
const box = (id: string, to: number, summary = makeSummary(id)) => ({
    id, fromMessageId: to - 1, toMessageId: to, summary,
});

describe('剧情六栏事件盒只读分层', () => {
    it('不改原六栏、人物、否定条件、未解决事项和用户协助指令', () => {
        const raw = makeSummary('小雨');
        const original = box('old', 10, raw);
        const view = longTermStoryArchiveView(raw);
        expect(view).toContain('【关键事件与因果】');
        expect(view).toContain('仍未履行');
        expect(view).toContain('【人物关系与转折】');
        expect(view).toContain('【新增设定与细节】');
        expect(view).toContain('银色钥匙仍由小雨保管');
        expect(view).toContain('【未解决事项与续写落点】');
        expect(view).toContain('用户协助指令');
        expect(view).not.toContain('【时间地点与场景】');
        expect(view).not.toContain('【好感与心理变化】');
        expect(original.summary).toBe(raw);
        expect(readStoryArchiveSections(original.summary || '')).toHaveLength(6);
        const withAffinity = makeSummary('小雨', {
            '好感与心理变化': '小雨动摇。\n界面好感记录（用户→角色）：阿泽 · +3 · 未告知角色',
        });
        expect(longTermStoryArchiveView(withAffinity)).toContain('界面好感记录');
    });

    it('最近两盒完整，老盒关键事实常驻；真正提到旧事才展开心理和地点', () => {
        const entries = Array.from({ length: 8 }, (_, index) => box('阶段' + (index + 1), (index + 1) * 10));
        const plain = selectLayeredStoryArchiveContext(entries, 100, '继续', 9000);
        expect(plain.filter(x => x.tier === 'recent-full')).toHaveLength(2);
        expect(plain.find(x => x.archiveId === '阶段8')?.text).toBe(entries[7].summary);
        expect(plain.find(x => x.archiveId === '阶段7')?.text).toBe(entries[6].summary);
        expect(plain.find(x => x.archiveId === '阶段1')?.tier).toBe('long-term');
        expect(plain.find(x => x.archiveId === '阶段1')?.text).not.toContain('【好感与心理变化】');
        const recalled = selectLayeredStoryArchiveContext(entries, 100, '阶段1的银色钥匙究竟还在谁手里？', 9000);
        const matched = recalled.find(x => x.archiveId === '阶段1');
        expect(matched?.tier).toBe('related-full');
        expect(matched?.text).toContain('害怕阿泽离开');
        expect(matched?.text).toContain('雨夜车站');
        const recentRelevant = selectLayeredStoryArchiveContext(entries, 100, '阶段6还有什么未实现的承诺？', 9000);
        expect(recentRelevant.find(x => x.archiveId === '阶段6')?.tier).toBe('related-full');
    });

    it('可召回早于最近8盒的剧情，不偷取未来楼层', () => {
        const boxes = Array.from({ length: 14 }, (_, index) => box('章节' + (index + 1), (index + 1) * 10));
        const remembered = selectLayeredStoryArchiveContext(boxes, 150, '章节1的银色钥匙呢？', 9000);
        expect(remembered.find(x => x.archiveId === '章节1')?.tier).toBe('related-full');
        const earlier = selectLayeredStoryArchiveContext(boxes, 65, '章节14的银色钥匙呢？', 9000);
        expect(earlier.every(x => x.toMessageId < 65)).toBe(true);
    });

    it('旧自由格式与六栏缺项均保留完整原文，空栏不会发垃圾占位', () => {
        const imported = '旧式剧情事实：A 否认得到钥匙。';
        const malformed = '【关键事件与因果】\n唯一一栏事实';
        expect(readStoryArchiveSections(imported)).toBeNull();
        expect(longTermStoryArchiveView(imported)).toBe(imported);
        expect(longTermStoryArchiveView(malformed)).toBe(malformed);
        const summary = makeSummary('小雨', { '新增设定与细节': '原文未交代' });
        const trimmed = longTermStoryArchiveView(summary);
        expect(trimmed).not.toContain('【新增设定与细节】');
        expect(summary).toContain('【新增设定与细节】');
    });

    it('预算有限时不会截断某一条事实，拼接楼号并且不会突变已保存的事件盒', () => {
        const source = [box('旧', 10), box('中', 20), box('近', 30)];
        const before = JSON.stringify(source);
        const selected = selectLayeredStoryArchiveContext(source, 50, '继续', 850);
        expect(selected.length).toBeGreaterThan(0);
        for (const item of selected) {
            expect(item.text).not.toMatch(/…$/);
            expect(source.some(entry => entry.id === item.archiveId)).toBe(true);
        }
        expect(JSON.stringify(source)).toBe(before);
        expect(renderLayeredStoryArchiveContext(selected, new Map([[9, 1], [10, 2], [19, 3], [20, 4], [29, 5], [30, 6]])))
            .toContain('事件盒');
    });
});
