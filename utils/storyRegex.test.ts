// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { applyStoryRegex, type StoryRegexRule } from './storyRegex';
import { parseStoryRegexDisplay } from './storyRegexDisplay';
import { StoryOutput } from '../components/date/story/StoryTheaterSession';

vi.mock('../context/OSContext', () => ({
    useOS: () => ({ theme: { storyAppearance: { preset: 'novel' } } }),
}));

const rule = (patch: Partial<StoryRegexRule> = {}): StoryRegexRule => ({
    id: 'rule', name: '测试', enabled: true, presetId: '', kind: 'filter', pattern: '<think>[\\s\\S]*?</think>',
    flags: 'g', replacement: '', display: true, history: false, instruction: '', ...patch,
});
const card = rule({
    kind: 'template', name: '手机剧场', pattern: '<app-card>([\\s\\S]*?)</app-card>',
    replacement: '<style>.phone { background: #ede9fe; }</style><article class="phone"><h3>手机通知</h3><p>{{$1}}</p></article>',
});

describe('剧情正则', () => {
    it.each([false, true])('按正文顺序嵌入 HTML 模板，酒馆来源=%s', fromTavern => {
        const tag = fromTavern ? 'content' : 'story_text';
        const source = `<${tag}>前文<app-card>第一行\n第二行</app-card>后文</${tag}>`;
        const output = applyStoryRegex(source, [card], 'display');
        const blocks = parseStoryRegexDisplay(output, fromTavern);
        expect(blocks.map(block => block.kind)).toEqual(['story', 'html', 'story']);
        const markup = renderToStaticMarkup(React.createElement(StoryOutput, { content: source, regexResult: output, fromTavern, affinityInputs: [] }));
        expect(markup).toContain('sandbox=""');
        expect(markup.indexOf('前文')).toBeLessThan(markup.indexOf('<iframe'));
        expect(markup.indexOf('<iframe')).toBeLessThan(markup.indexOf('后文'));
        expect(markup).toContain('第二行');
        expect(markup).not.toContain('SULLYREGEXCARD');
    });

    it('历史和阅读分别过滤，保留原文和模型的标签格式', () => {
        const source = '<think>内部\n记录</think><app-card>到家了</app-card>「甲」';
        const onlyHistory = rule({ history: true, display: false });
        const onlyDisplay = rule({ pattern: '/「(.*?)」/g', replacement: '「$1说」' });
        const rules = [card, onlyHistory, onlyDisplay, rule({ enabled: false, pattern: '到家了', replacement: '不该显示' })];
        expect(applyStoryRegex(source, rules, 'history')).toEqual({
            text: '<app-card>到家了</app-card>「甲」', cards: [], matches: 1,
        });
        const display = applyStoryRegex(source, rules, 'display');
        expect(display.text).toContain('<think>内部\n记录</think>');
        expect(display.text).toContain('「甲说」');
        expect(display.cards[0].html).toContain('到家了');
        expect(source).toContain('<app-card>到家了</app-card>');
    });

    it('角色直出的 HTML 保留原入口，模板捕获组只能填入安全文字', () => {
        const source = '<div class="original">角色自带 HTML</div><content>开头'
            + '<app-card><img src="https://example.invalid" onerror="boom()"></app-card>结尾</content>';
        const output = applyStoryRegex(source, [card], 'display');
        const blocks = parseStoryRegexDisplay(output, true);
        expect(blocks.filter(block => block.kind === 'html')).toHaveLength(2);
        expect(blocks.find(block => !block.regexTemplate && block.kind === 'html')?.htmlSource).toContain('角色自带 HTML');
        expect(output.cards[0].html).toContain('&lt;img');
        expect(output.cards[0].html).not.toContain('<img');
    });

    it('拒绝超出展示体积的替换', () => {
        const source = 'x'.repeat(6000);
        const huge = rule({ pattern: '(x+)', replacement: '$1'.repeat(1000) });
        expect(() => applyStoryRegex(source, [huge], 'display')).toThrow('正则替换结果过长');
    });
});
