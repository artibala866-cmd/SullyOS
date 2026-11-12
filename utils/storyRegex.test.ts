// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { applyStoryRegex, type StoryRegexRule } from './storyRegex';
import { hideStoryStatusForDisplay, parseStoryRegexDisplay } from './storyRegexDisplay';
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
        expect(markup).toContain('sandbox="allow-scripts"');
        expect(markup).not.toContain('sandbox="allow-scripts allow-same-origin"');
        expect(markup).toContain('nonce-sully-story-template-runtime');
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


describe('酒馆状态栏：只在剧情正文隐藏，编辑和 AI 原文保留', () => {
    const status = '{时间:夜晚20:38|地点:出租屋·客厅|纠缠：44.5|状态:看着{{user}}脸上的烛光|衣着:针织衫|心声:*快结束吧*|渴望:回到宿舍|备忘:1.明早有课|记账:   | 广阅:先活到夏天吧}';

    it('自动隐藏已导入的多字段状态栏，保留后续正文和原始输入', () => {
        const raw = status + '\n\n{{char}}轻声说：“生日快乐。”';
        const displayed = parseStoryRegexDisplay({ text: raw, cards: [], matches: 0 }, false);
        expect(displayed.map(block => block.text).join('\n')).toContain('生日快乐');
        expect(displayed.map(block => block.text).join('\n')).not.toContain('纠缠');
        expect(displayed.map(block => block.text).join('\n')).not.toContain('心声');
        expect(raw).toContain(status);
    });

    it('支持首尾及多处独立状态块，普通正文和双花括号不丢失', () => {
        const raw = '第一段。\n' + status + '\n第二段 {{user}}。\n{时间:次日|地点:学校}\n第三段。';
        const visible = hideStoryStatusForDisplay(raw);
        expect(visible).toContain('第一段。');
        expect(visible).toContain('第二段 {{user}}。');
        expect(visible).toContain('第三段。');
        expect(visible).not.toContain('纠缠');
        expect(visible).not.toContain('{时间:次日');
    });

    it('绝不移除非独立状态栏、未闭合块或其他花括号文本', () => {
        const raw = '她说：“{时间:上午|地点:寝室}”，然后笑了。\n'
            + '{{user}} {物品:茶杯|颜色:白色}\n'
            + '{时间:晚上|地点:客厅\n仍在写正文。';
        expect(hideStoryStatusForDisplay(raw)).toBe(raw);
    });

    it('隐藏只影响展示，既有开场白依旧完整传入模型历史', async () => {
        const { buildStoryHistory } = await import('./storyTheater');
        const original = status + '\n蜡烛亮着。';
        const floor = {
            id: 1, timestamp: 1, role: 'assistant', charId: 'story-theater:test', type: 'text',
            content: original, metadata: {
                source: 'story_theater',
                theaterOpeningGreeting: { characterId: 'actor', greetingId: 'tavern-alt-1' },
            },
        } as any;
        const history = buildStoryHistory([floor]);
        expect(history[0].content).toContain(status);
        expect(floor.content).toBe(original);
        expect(hideStoryStatusForDisplay(original)).not.toContain('纠缠');
    });

    it('实渲染时读者看不到状态栏', () => {
        const raw = status + '\n夜色渐深。';
        const html = renderToStaticMarkup(React.createElement(StoryOutput, {
            content: raw, affinityInputs: [], fromTavern: false,
        }));
        expect(html).toContain('夜色渐深');
        expect(html).not.toContain('纠缠');
        expect(html).not.toContain('时间:夜晚');
    });
});
