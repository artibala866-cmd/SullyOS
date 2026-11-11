import { describe, expect, it, vi } from 'vitest';
import { applyStoryRegex, type StoryRegexRule } from './storyRegex';
import { applyAlchemyRequestHistoryRules, applyMeetingAlchemyRequest } from './alchemyMeeting';
import { DB } from './db';

vi.mock('./storyRegexRunner', () => ({
    runStoryRegex: (values: Array<{ text: string; role: 'assistant' | 'user' }>,
        rules: StoryRegexRule[], stage: 'display' | 'history') =>
        Promise.resolve(values.map(value => applyStoryRegex(value, rules, stage))),
}));

const rule = (patch: Partial<StoryRegexRule> = {}): StoryRegexRule => ({
    id: 'filter-test', name: '过滤测试', enabled: true, presetId: '',
    kind: 'filter', domain: 'online', targets: ['online', 'offline'],
    pattern: '<private>[\\s\\S]*?</private>', flags: 'g', replacement: '',
    display: false, history: true, instruction: '', role: 'both', ...patch,
});

describe('Online and offline prompt-history rules never rewrite saved message objects', () => {
    it('filters the request copy for both speaker roles but leaves original source untouched', async () => {
        const source = [
            { role: 'system', content: '系统<private>要保留</private>' },
            { role: 'user', content: '我说<private>私密备注</private>你好' },
            { role: 'assistant', content: '答复<private>隐藏</private>收到' },
        ];
        const request = [...source];
        await applyAlchemyRequestHistoryRules(request, [rule()]);
        expect(request.map(x => x.content)).toEqual(['系统<private>要保留</private>', '我说你好', '答复收到']);
        expect(source.map(x => x.content)).toEqual([
            '系统<private>要保留</private>',
            '我说<private>私密备注</private>你好',
            '答复<private>隐藏</private>收到',
        ]);
        expect(request[0]).toBe(source[0]);
        expect(request[1]).not.toBe(source[1]);
        expect(request[2]).not.toBe(source[2]);
    });

    it('meeting executes a preset-bound offline rule with no preset, without a second API call', async () => {
        const stored = rule({ id: 'bound-story', presetId: 'my-story-preset',
            targets: ['offline'], domain: 'offline',
            instruction: '不要透露隐藏字段', role: 'both' });
        const spy = vi.spyOn(DB, 'getAsset').mockResolvedValue(JSON.stringify([stored]));
        try {
            const saved = [
                { role: 'user', content: '你好<private>留在数据库里</private>' },
                { role: 'assistant', content: '回应<private>只给模型删除</private>' },
            ];
            const request = [...saved];
            await applyMeetingAlchemyRequest(request, '你好', { user: '我', char: '角色' });
            expect(request[0]).toEqual({ role: 'system', content: '不要透露隐藏字段' });
            expect(request.slice(1).map(item => item.content)).toEqual(['你好', '回应']);
            expect(saved[0].content).toContain('留在数据库里');
            expect(saved[1].content).toContain('只给模型删除');
        } finally {
            spy.mockRestore();
        }
    });

    it('respects prompt-stage and role switches; never runs HTML templates as history filters', async () => {
        const source = [
            { role: 'user', content: '<private>用户标签</private>原话' },
            { role: 'assistant', content: '<private>角色标签</private>回复' },
        ];
        const displayOnly = rule({ history: false, display: true });
        const template = rule({ kind: 'template', display: true, history: false,
            replacement: '<p>{{$1}}</p>' });
        const request = [...source];
        await applyAlchemyRequestHistoryRules(request, [displayOnly, template]);
        expect(request).toEqual(source);
        const onlyAssistant = [...source];
        await applyAlchemyRequestHistoryRules(onlyAssistant, [rule({ role: 'assistant' })]);
        expect(onlyAssistant[0].content).toBe(source[0].content);
        expect(onlyAssistant[1].content).toBe('回复');
        expect(source[1].content).toContain('角色标签');
    });
});
