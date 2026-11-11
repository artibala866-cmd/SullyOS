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

    it('重导入旧版两份正则时自动补全丢失的核心指令、不制造第二条同名规则', () => {
        const payload = JSON.stringify([
            { name: 'WS8.3-核心指令(全维度禁令声明)', pattern: '^(?=.)',
                flags: 'gm', replacement: '', aiPrompt: '核心禁令内容', applyOnDisplay: 0, applyOnPrompt: 1 },
            { name: '番茄小剧场', pattern: '<minitheater>([\\s\\S]*?)</minitheater>',
                htmlTemplate: '<p>{{1.title}}</p>', isHtmlTemplate: 1, parseMode: 'json',
                aiPrompt: '番茄格式指令', triggerEnabled: 1, triggerKeywords: '' },
        ]);
        const imported = parseStoryRegexImport(payload).rules;
        const older = imported.map((rule, index) => ({
            ...rule,
            ...(index === 0 ? { instruction: '' } : {}),
            ...(index === 1 ? { source: { ...rule.source, triggerKeywords: [] } } : {}),
        }));
        const saved = readStoryRegexRules(JSON.stringify(older));
        const result = mergeStoryRegexImport(saved, imported, '');
        expect(result).toMatchObject({ added: 0, updated: 1, duplicates: 1 });
        expect(result.rules).toHaveLength(2);
        expect(result.rules[0].id).toBe(saved[0].id);
        expect(result.rules[0].instruction).toBe('核心禁令内容');
        expect(storyRegexInstruction(result.rules[0], {}, '继续')).toBe('核心禁令内容');
        expect(mergeStoryRegexImport(result.rules, imported, '')).toMatchObject({ added: 0, updated: 0, duplicates: 2 });
    });

    it('按原版炼金术解析酒馆 extensions.regex_scripts 与独立 findRegex', () => {
        const source = [{
            scriptName: '只处理AI输出', findRegex: '/<think>[\\s\\S]*?<\\/think>/gi',
            replaceString: '', placement: [2], promptOnly: true, markdownOnly: false,
            disabled: false, minDepth: '0', maxDepth: '2', substituteRegex: 0,
            trimStrings: ['无用文字'],
        }, {
            scriptName: '用户与角色都处理', findRegex: '/(开心|快乐)/g',
            replaceString: '满足', placement: [1, 2], markdownOnly: true,
            disabled: true,
        }];
        const variants = [
            JSON.stringify({ extensions: { regex_scripts: source } }),
            JSON.stringify({ regex_scripts: source }),
            JSON.stringify(source),
        ];
        for (const data of variants) {
            const result = parseStoryRegexImport(data);
            expect(result.rejected).toBe(0);
            expect(result.rules).toHaveLength(2);
            const [aiOnly, both] = result.rules;
            expect(aiOnly).toMatchObject({
                name: '只处理AI输出', enabled: true, role: 'assistant', display: false,
                history: true, flags: 'gi', source: { minDepth: 0, maxDepth: 2, substituteRegex: 0 },
            });
            expect(applyStoryRegex({ text: '正文<think>秘密</think>', role: 'assistant', depth: 1 },
                result.rules, 'history').text).toBe('正文');
            expect(applyStoryRegex({ text: '正文<think>秘密</think>', role: 'assistant', depth: 3 },
                result.rules, 'history').text).toContain('<think>');
            expect(both).toMatchObject({ enabled: false, role: 'both', display: true, history: false });
        }
        const single = parseStoryRegexImport(JSON.stringify({
            scriptName: '单条', findRegex: '/abc/i', replaceString: '成功',
        }));
        expect(single.rules).toHaveLength(1);
        expect(applyStoryRegex('ABC', single.rules, 'display').text).toBe('成功');
    });

    it('原版 placement 与 promptOnly/markdownOnly 的全部作用组合没有颠倒', () => {
        const variants = [
            { placement: [], markdownOnly: false, promptOnly: false, role: 'assistant', display: true, history: true },
            { placement: [1], markdownOnly: false, promptOnly: true, role: 'user', display: false, history: true },
            { placement: [1, 2], markdownOnly: true, promptOnly: false, role: 'both', display: true, history: false },
            { placement: [1, 2], markdownOnly: true, promptOnly: true, role: 'both', display: true, history: true },
        ] as const;
        for (const [index, row] of variants.entries()) {
            const converted = parseStoryRegexImport(JSON.stringify({
                scriptName: '格式' + index, findRegex: '事件', replaceString: '处理',
                placement: row.placement, markdownOnly: row.markdownOnly, promptOnly: row.promptOnly,
            }));
            const result = converted.rules[0];
            expect(result).toMatchObject({ role: row.role, display: row.display, history: row.history });
            expect(result.enabled).toBe(true);
        }
    });

    it('原版花括号正则不被擅自改写，私聊限定不能误变全局', () => {
        const rows = [{
            name: '保留字面大括号', pattern: '字面{a,b}', replacement: '替换', flags: 'g',
        }, {
            name: '私聊单独生效', pattern: '秘密', replacement: '', scope: 'chat',
            characterIds: [], scenes: ['chat'],
        }];
        const result = parseStoryRegexImport(JSON.stringify(rows));
        expect(result.rules[0].pattern).toBe(rows[0].pattern);
        expect(result.rules[1].enabled).toBe(false);
        expect(result.warnings.join('')).toContain('绑定了糯叽机角色');
    });

    it('按原版运行时处理 flags 全局、替换值 trimStrings 和 JSON order', () => {
        const source = [
            { name: '只修饰大小写', pattern: 'a', flags: 'i', replacement: 'X', order: 25 },
            { name: '替换时修剪', pattern: 'a', flags: 'g', replacement: '$&*',
                trimStrings: ['*'], order: 11 },
        ];
        const rules = parseStoryRegexImport(JSON.stringify(source)).rules;
        expect(rules.map(rule => rule.order)).toEqual([11, 25]);
        expect(rules[1].flags).toBe('gi');
        expect(applyStoryRegex('a*a', [rules[0]], 'display').text).toBe('a*a');
        expect(applyStoryRegex('a*a', [rules[0], rules[1]], 'display').text).toBe('X*X');
    });

    it('原版 ST 简写与量词、转义大括号互不干扰', () => {
        const rows = [
            { name: '炼金多选', pattern: '{刻,揉,融}进骨血', flags: 'g', replacement: '改写' },
            { name: '量词', pattern: '\\d{2,5}', flags: 'g', replacement: 'NUM' },
            { name: '字面花括号', pattern: '\\{刻,揉\\}', flags: 'g', replacement: 'LITERAL' },
            { name: '单项简写', pattern: '称呼{宝宝}', flags: 'g', replacement: '亲昵称呼' },
        ];
        const rules = parseStoryRegexImport(JSON.stringify(rows)).rules;
        expect(rules).toHaveLength(4);
        expect(rules[0].pattern).toBe('{刻,揉,融}进骨血');
        expect(applyStoryRegex('刻进骨血 揉进骨血 融进骨血', [rules[0]], 'display').text)
            .toBe('改写 改写 改写');
        expect(applyStoryRegex('12 123456', [rules[1]], 'display').text).toBe('NUM NUM6');
        expect(applyStoryRegex('字面{刻,揉}', [rules[2]], 'display').text).toBe('字面LITERAL');
        expect(applyStoryRegex('称呼宝宝', [rules[3]], 'display').text).toBe('亲昵称呼');
    });

    it('原版 order 保证模板先执行，后续过滤不能吞掉生成卡片', () => {
        const rows = [
            { name: '后续过滤', pattern: '<card>', replacement: '已清理', order: 20 },
            { name: '卡片', pattern: '<card>([\\s\\S]*?)</card>', isHtmlTemplate: true,
                htmlTemplate: '<div class="card">{{ $1 }}</div>', order: 10, parseMode: 'text' },
        ];
        const rules = parseStoryRegexImport(JSON.stringify(rows)).rules;
        const rendered = applyStoryRegex('<card>内容</card> <card>第二张</card>', rules, 'display');
        expect(rendered.cards).toHaveLength(2);
        expect(rendered.cards[0].html).toContain('内容');
        expect(rendered.cards[1].html).toContain('第二张');
        expect(rendered.text).not.toContain('已清理');
    });

    it('再次导入有 order 和 renderMode 的同一张原卡不重复', () => {
        const source = JSON.stringify({
            name: '一张卡', pattern: '<ticket>([\\s\\S]*?)</ticket>', flags: 'g',
            isHtmlTemplate: true, htmlTemplate: '<p>{{1.title}}</p>', parseMode: 'json',
            renderMode: 'iframe', scenes: ['chat'], order: 11,
        });
        const [newRule] = parseStoryRegexImport(source).rules;
        const oldRule = { ...newRule, order: undefined, source: {
            ...newRule.source, scenes: undefined, renderMode: undefined,
        } };
        const merged = mergeStoryRegexImport([oldRule], [newRule], '');
        expect(merged).toMatchObject({ added: 0, updated: 1, duplicates: 0 });
        expect(merged.rules[0].order).toBe(11);
        expect(mergeStoryRegexImport(merged.rules, [newRule], '')).toMatchObject({
            added: 0, updated: 0, duplicates: 1,
        });
    });

});
