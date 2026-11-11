// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mergeStoryRegexImport, parseStoryRegexImport } from './storyRegexImport';
import { applyStoryRegex, readStoryRegexRules, storyRegexInstruction } from './storyRegex';
import { parseStoryRegexDisplay } from './storyRegexDisplay';
import { sanitizeStoryTheaterHtml } from './storyTheaterHtml';

describe('糯叽机炼金术导入', () => {
    it('按原文件顺序转换数字开关、作用对象、显示与请求规则，并保留现有库', () => {
        const { rules, warnings } = parseStoryRegexImport('\uFEFF' + JSON.stringify([
            { name: '格式整理', pattern: '(<note>)([^<]+)</note>', replacement: '$2', order: 8, enabled: 0, applyOnDisplay: 1 },
            { name: '隐藏备注', pattern: '/<ooc>[\\s\\S]*?<\\/ooc>/i', replacement: '', order: 1,
                enabled: 1, role: 'both', scenes: ['chat'], applyOnDisplay: 0, applyOnPrompt: 1 },
        ]));
        expect(warnings).toEqual([]);
        expect(rules.map(rule => [rule.name, rule.enabled])).toEqual([['隐藏备注', true], ['格式整理', false]]);
        const input = { text: '正文<OOC>隐藏</OOC>', role: 'user' as const };
        expect(applyStoryRegex(input, rules, 'display').text).toBe(input.text);
        expect(applyStoryRegex(input, rules, 'history').text).toBe('正文');
        const merged = mergeStoryRegexImport([], rules, 'story-preset');
        const saved = readStoryRegexRules(JSON.stringify(merged.rules));
        expect(saved.map(rule => rule.presetId)).toEqual(['story-preset', 'story-preset']);
        expect(mergeStoryRegexImport(saved, parseStoryRegexImport(JSON.stringify([
            { name: '隐藏备注', pattern: '/<ooc>[\\s\\S]*?<\\/ooc>/i', replacement: '',
                enabled: 0, role: 'both', scenes: ['chat'], applyOnDisplay: 0, applyOnPrompt: 1 },
        ])).rules, 'story-preset')).toMatchObject({ added: 0, duplicates: 1 });
    });

    it('保留键值模板、CSS、捕获顺序和按需发送的格式指令', () => {
        const { rules: [rule] } = parseStoryRegexImport(JSON.stringify({
            name: '状态栏', isHtmlTemplate: true, pattern: '<status>([\\s\\S]*?)</status>', flags: 'g', parseMode: 'kv',
            htmlTemplate: '<section class="status">{{1.地点}} · {{1.心情}} · {{char}}</section>',
            cssScope: '.status{display:flex;padding:8px;border-radius:8px}', aiPrompt: '为 {{char}} 生成 <status>。', applyOnDisplay: 1,
            triggerEnabled: 1, triggerKeywords: '状态，天气',
        }));
        const context = { char: 'A < B' };
        const source = '<story_text>前文<status>心情：安静｜地点：海边</status>后文</story_text>';
        const result = applyStoryRegex(source, [rule], 'display', context);
        expect(result.cards[0].html).toContain('海边 · 安静 · A &lt; B');
        const blocks = parseStoryRegexDisplay(result, false);
        expect(blocks.map(block => block.kind)).toEqual(['story', 'html', 'story']);
        expect(sanitizeStoryTheaterHtml(blocks[1].htmlSource!).srcDoc).toContain('border-radius:8px');
        expect(storyRegexInstruction(rule, context, '看看状态')).toBe('为 A < B 生成 <status>。');
        expect(storyRegexInstruction(rule, context, '继续')).toBe('');
        expect(applyStoryRegex(source, [rule], 'history').text).toBe(source);
    });

    it('从 JSON 捕获组读取嵌套字段和列表，逐项 HTML 转义', () => {
        const { rules: [rule] } = parseStoryRegexImport(JSON.stringify({
            name: '手机聊天', isHtmlTemplate: 1, pattern: '<screen>([\\s\\S]*?)</screen>', parseMode: 'json',
            htmlTemplate: '<article><h3>{{1.screen.title}}</h3>{{#each:1.items}}<p>{{sender}}：{{message}}</p>{{/each}}</article>',
        }));
        const payload = JSON.stringify({ screen: { title: '夜班聊天' }, items: [
            { sender: '小江', message: '<img onerror="boom">' }, { sender: '我', message: '等你' },
        ] });
        const html = applyStoryRegex(`<screen>${payload}</screen>`, [rule], 'display').cards[0].html;
        expect(html).toContain('<h3>夜班聊天</h3>');
        expect(html).toContain('小江：&lt;img');
        expect(html).toContain('<p>我：等你</p>');
        expect(html).not.toContain('<img');
    });

    it('保留旧版分组、文字转义、替换数组、全匹配变量和楼层深度', () => {
        const legacy = { name: '旧规则', enabled: true, subRules: [
            { targets: ['a+b'], mode: 'text', replacements: ['一', '二'] },
            { targets: ['(OOC)'], mode: 'regex', replacements: ['{{match}}!'] },
        ] };
        const { rules } = parseStoryRegexImport(JSON.stringify(legacy));
        expect(rules.map(rule => rule.name)).toEqual(['旧规则 #1', '旧规则 #2']);
        expect(applyStoryRegex('a+b OOC', rules, 'display').text).toMatch(/^[一二] OOC!$/);
        const { rules: [scoped] } = parseStoryRegexImport(JSON.stringify({
            name: '替换最新楼', pattern: '{{char}}', substituteRegex: 2, replacement: 'A', minDepth: 0, maxDepth: 0,
        }));
        expect(applyStoryRegex({ text: 'X+ XX', depth: 0 }, [scoped], 'display', { char: 'X+' }).text).toBe('A XX');
        expect(applyStoryRegex({ text: 'X+ XX', depth: 1 }, [scoped], 'display', { char: 'X+' }).text).toBe('X+ XX');
    });


    it('把普通正则中用于显示的 HTML 转为卡片，同时保留独立的请求替换', () => {
        const result = parseStoryRegexImport(JSON.stringify({
            name: '小卡片', pattern: '<note>(.*?)</note>', replacement: '<div>$1</div>', applyOnDisplay: 1, applyOnPrompt: 1,
        }));
        expect(result.rules.map(rule => rule.kind)).toEqual(['template', 'filter']);
        expect(applyStoryRegex('<note>正文</note>', result.rules, 'display').cards[0].html).toBe('<div>正文</div>');
        expect(applyStoryRegex('<note>正文</note>', result.rules, 'history').text).toBe('<div>正文</div>');
    });

    it('卡片可用局部根样式和定位，外链和可执行内容仍会被过滤', () => {
        const source = '<style>body{--accent:#432;color:var(--accent)}.screen{position:relative}</style>'
            + '<article class="screen"><img src="https://example.invalid/img.png"><script>window.attack()</script>通知</article>';
        const html = sanitizeStoryTheaterHtml(source, true);
        expect(html.srcDoc).toContain('.story-theater-html-content{--accent:#432;color:var(--accent)}');
        expect(html.srcDoc).toContain('position:relative');
        expect(html.srcDoc).not.toContain('window.attack');
        expect(html.srcDoc).not.toContain('https://example.invalid');
        expect(sanitizeStoryTheaterHtml(source).srcDoc).not.toContain('position:relative');
    });

    it('跨应用限定规则停用，无效规则给出原因且不影响其他规则', () => {
        const result = parseStoryRegexImport(JSON.stringify([
            { name: '限定角色', pattern: 'A', scope: 'character', characterIds: ['nuoji-id'] },
            { name: '错误表达式', pattern: '[', flags: 'g' },
            { name: '仅论坛', pattern: 'B', scenes: ['forum'] },
            { name: '正常项', pattern: 'C', scenes: ['isekai'] },
        ]));
        expect(result.rejected).toBe(1);
        expect(result.rules.map(rule => rule.enabled)).toEqual([false, false, true]);
        expect(result.warnings).toEqual(expect.arrayContaining([
            expect.stringContaining('限定角色'), expect.stringContaining('错误表达式'), expect.stringContaining('仅论坛'),
        ]));
    });
    it('把 7.5 八股补丁的提示词独立注入请求，不把原文清空', () => {
        const prompt = '[System: Living Persona Cognitive OS - Final Unified Enforced Edition v8.3]\n禁止套路化描写';
        const { rules: [core] } = parseStoryRegexImport(JSON.stringify({
            name: 'WS8.3-核心指令(全维度禁令声明)', pattern: '^(?=.)', flags: 'gm',
            replacement: '', aiPrompt: prompt, applyOnDisplay: 0, applyOnPrompt: 1,
            isHtmlTemplate: false, enabled: 1,
        }));
        expect(core.enabled).toBe(true);
        expect(core.kind).toBe('filter');
        expect(core.history).toBe(true);
        expect(core.instruction).toBe(prompt);
        expect(storyRegexInstruction(core, {}, '暂停剧情')).toBe(prompt);
        expect(applyStoryRegex('原文内容', [core], 'history').text).toBe('原文内容');
        expect(applyStoryRegex('原文内容', [core], 'display').text).toBe('原文内容');
    });

    it('番茄小剧场开启触发但无关键词时，不吞掉输出格式指令', () => {
        const parsed = parseStoryRegexImport(JSON.stringify({
            name: '番茄小剧场', pattern: '<minitheater>([\\s\\S]*?)</minitheater>',
            isHtmlTemplate: true, parseMode: 'json', htmlTemplate: '<div>{{1.title}}</div>',
            aiPrompt: '输出 <minitheater> 格式', triggerEnabled: 1, triggerKeywords: '',
        }));
        expect(parsed.warnings.join('')).toContain('关键词为空');
        expect(parsed.rules[0].source?.triggerKeywords).toBeUndefined();
        expect(storyRegexInstruction(parsed.rules[0], {}, '暂停当前剧情，写一个小剧场'))
            .toBe('输出 <minitheater> 格式');
        expect(applyStoryRegex('<minitheater>{"title":"苹果"}<\/minitheater>',
            parsed.rules, 'display').cards[0].html).toContain('苹果');
    });

});
