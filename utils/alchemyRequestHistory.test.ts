import { describe, expect, it, vi } from 'vitest';
import { applyStoryRegex, type StoryRegexRule } from './storyRegex';
import { applyAlchemyRequestHistoryRules } from './alchemyMeeting';

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
