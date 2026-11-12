// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { exportStoryAlchemyRules, mergeStoryRegexImport, parseStoryRegexImport } from './storyRegexImport';
import { applyStoryRegex, readStoryRegexRules, storyRegexInstruction } from './storyRegex';
import { parseStoryRegexDisplay } from './storyRegexDisplay';
import { sanitizeStoryTheaterHtml } from './storyTheaterHtml';
import { ALCHEMY_REFERENCE_REGEX_PRESETS, ALCHEMY_REFERENCE_HTML_PRESETS } from './alchemyReferencePresets';

describe('糯叽机炼金术导入', () => {
    it('原版角色绑定必须手动适配，绝不泄露到其他糯米机角色或线上请求', () => {
        const native = parseStoryRegexImport(JSON.stringify({
            name: '原作者专属正则', pattern: '秘密词', replacement: '隐去',
            scope: 'character', characterIds: ['foreign-app-id'],
            scenes: ['chat'], applyOnDisplay: 1, applyOnPrompt: 1,
            aiPrompt: '原作者限定的指令', enabled: 1,
        })).rules[0];
        expect(native.enabled).toBe(false);
        expect(native.source?.originalCharacterIds).toEqual(['foreign-app-id']);
        const mapped = { ...native, enabled: true, source: {
            ...native.source, localCharacterIds: ['local-a'],
        } };
        const input = (id: string) => ({ text: '秘密词',
            role: 'assistant' as const, characterId: id, scene: 'chat' });
        expect(applyStoryRegex(input('local-a'), [mapped], 'display').text).toBe('隐去');
        expect(applyStoryRegex(input('local-b'), [mapped], 'display').text).toBe('秘密词');
        expect(applyStoryRegex('秘密词', [mapped], 'display').text).toBe('秘密词');
        expect(storyRegexInstruction(mapped, { characterId: 'local-b', scene: 'chat' }, '秘密词')).toBe('');
        expect(storyRegexInstruction(mapped, { characterId: 'local-a', scene: 'chat' }, '秘密词'))
            .toBe('原作者限定的指令');
        const unbound = { ...mapped, source: { ...mapped.source, localCharacterIds: [] } };
        expect(applyStoryRegex(input('local-a'), [unbound], 'display').text).toBe('秘密词');
    });

    it('原版无角色 ID 的聊天范围可以应用于当前聊天，手选线下位置不受原版 chat 场景限制', () => {
        const rule = parseStoryRegexImport(JSON.stringify({
            name: '通用聊天规则', pattern: '旧字', replacement: '新字',
            scope: 'chat', characterIds: [], scenes: ['chat'],
            enabled: 1, applyOnDisplay: 1,
        })).rules[0];
        expect(rule.enabled).toBe(true);
        expect(applyStoryRegex({ text: '旧字', characterId: 'local-a', scene: 'chat' }, [rule], 'display').text).toBe('新字');
        expect(applyStoryRegex({ text: '旧字', scene: 'chat' }, [rule], 'display').text).toBe('旧字');
        const offline = { ...rule, source: { ...rule.source, originalScope: 'global' }, offlineScenes: ['meeting' as const] };
        expect(applyStoryRegex({ text: '旧字', scene: 'meeting' }, [offline], 'display').text).toBe('新字');
    });
 
    it('保留糯叽机原版五个文字预设和四个 HTML 预设，均为用户主动选择', () => {
        expect(ALCHEMY_REFERENCE_REGEX_PRESETS).toHaveLength(5);
        expect(ALCHEMY_REFERENCE_HTML_PRESETS).toHaveLength(4);
        const source = [...ALCHEMY_REFERENCE_REGEX_PRESETS, ...ALCHEMY_REFERENCE_HTML_PRESETS];
        const { rules, rejected, warnings } = parseStoryRegexImport(JSON.stringify(source));
        expect(rejected).toBe(0);
        expect(warnings).toEqual([]);
        expect(rules).toHaveLength(9);
        expect(rules.filter(rule => rule.kind === 'template')).toHaveLength(4);
        expect(rules.find(rule => rule.name === '心聲卡片')?.instruction).toContain('<心聲>');
        expect(rules.find(rule => rule.name === '好感度進度條')?.replacement).toContain('{{1.值}}');
        const html = rules.find(rule => rule.name === '心情狀態欄')!;
        const rendered = applyStoryRegex('<status>心情:放松|時間:下午|地點:海边</status>', [html], 'display');
        expect(rendered.cards).toHaveLength(1);
        expect(rendered.cards[0].html).toContain('海边');
        // Presets do not appear in saved rules unless specifically merged.
        expect(mergeStoryRegexImport([], [], '').rules).toEqual([]);
    });

    it('按糯叽机原版字段导出所选规则，能重新导入且不丢 HTML、触发和原始扩展信息', () => {
        const source = [
            { name: '原版文字替换', pattern: '旧称', flags: 'g', replacement: ['新称', '别称'],
                role: 'both', scope: 'global', scenes: ['chat'], category: '文本规则',
                enabled: 1, applyOnDisplay: 1, applyOnPrompt: 1, trimStrings: ['\u200b'], order: 8,
                extraAuthorField: 'keep-original' },
            { name: '原版美化', isHtmlTemplate: 1, pattern: '<card>(.*?)</card>',
                htmlTemplate: '<div onclick="this.textContent=\'展开\'">{{$1}}</div>',
                cssScope: '.card{padding:9px}', parseMode: 'text', renderMode: 'iframe',
                triggerEnabled: 1, triggerKeywords: ['卡片'], aiPrompt: '输出 <card> 标签',
                enabled: 1, applyOnDisplay: 1, category: '卡片', order: 9 },
        ];
        const imported = parseStoryRegexImport(JSON.stringify(source)).rules;
        const native = JSON.parse(exportStoryAlchemyRules(imported));
        expect(native).toHaveLength(2);
        expect(native[0]).toMatchObject({ extraAuthorField: 'keep-original',
            name: '原版文字替换', role: 'both', replacement: ['新称', '别称'] });
        expect(native[1]).toMatchObject({ isHtmlTemplate: true, renderMode: 'iframe',
            triggerEnabled: true, triggerKeywords: ['卡片'], aiPrompt: '输出 <card> 标签' });
        expect(native[1].htmlTemplate).toContain('onclick');
        const again = parseStoryRegexImport(JSON.stringify(native)).rules;
        expect(again).toHaveLength(2);
        expect(again[0].replacementChoices).toEqual(['别称']);
        expect(again[1].kind).toBe('template');
        expect(again[1].replacement).toContain('padding:9px');
        expect(again[1].instruction).toBe('输出 <card> 标签');
    });


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
        // Chat-scoped without a foreign character ID is valid, but only in
        // an actual chat, never as a global story/meeting filter.
        expect(result.rules[1].enabled).toBe(true);
        expect(applyStoryRegex({ text: '秘密', characterId: 'local-role', scene: 'chat' }, [result.rules[1]], 'display').text).toBe('');
        expect(applyStoryRegex({ text: '秘密', scene: 'story' }, [result.rules[1]], 'display').text).toBe('秘密');
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

    it('见面专用导入不保存剧情预设，重复导入也不覆盖线下场景选择', () => {
        const { rules: [parsed] } = parseStoryRegexImport(JSON.stringify({
            name: '见面场景词汇', pattern: '像草莓一样', flags: 'g',
            replacement: '', applyOnDisplay: true,
        }));
        const meetingOnly = { ...parsed, domain: 'offline' as const,
            targets: ['offline'] as Array<'offline'>,
            offlineScenes: ['meeting'] as Array<'meeting'> };
        const meeting = mergeStoryRegexImport([], [meetingOnly], 'story-A');
        expect(meeting.rules[0].presetId).toBe('');
        expect(meeting.rules[0].offlineScenes).toEqual(['meeting']);
        const originalStoryOnly = { ...parsed, domain: 'offline' as const,
            targets: ['offline'] as Array<'offline'>,
            offlineScenes: ['story'] as Array<'story'> };
        const story = mergeStoryRegexImport([], [originalStoryOnly], 'story-A');
        expect(story.rules[0].presetId).toBe('story-A');
        expect(story.rules[0].offlineScenes).toEqual(['story']);
        const combined = mergeStoryRegexImport(story.rules, [
            { ...originalStoryOnly, offlineScenes: ['story', 'meeting'] as Array<'story' | 'meeting'> },
        ], 'story-A');
        expect(combined).toMatchObject({ added: 0, duplicates: 1 });
        expect(combined.rules).toHaveLength(1);
        expect(combined.rules[0].offlineScenes).toEqual(['story']);
    });

    it('imports any text regex without added smart identification or prompts', () => {
        const topics = ['雨伞', '玻璃', '珊瑚', '钥匙', '松鼠'];
        const rows = topics.map((topic, index) => ({
            name: '原作者自由名称 ' + index, category: '自定义集合' + index,
            pattern: '(像' + topic + '一样|' + topic + ')',
            flags: 'g', replacement: '', enabled: 1, applyOnDisplay: 1,
            applyOnPrompt: 1, aiPrompt: '',
        }));
        const imported = parseStoryRegexImport(JSON.stringify(rows));
        expect(imported.rules).toHaveLength(topics.length);
        expect(imported.rules.every(rule => rule.source?.smartFilter === undefined)).toBe(true);
        for (const [index, topic] of topics.entries()) {
            const rule = imported.rules[index];
            expect(rule.instruction).toBe('');
            const sentence = '她拿起' + topic + '，然后说它像' + topic + '一样。';
            for (const stage of ['display', 'history'] as const) {
                const result = applyStoryRegex(sentence, [rule], stage);
                expect(result.text).toBe('她拿起，然后说它。');
                expect(result.matches).toBe(2);
                const oldStored = { ...rule, source: { ...rule.source, smartFilter: true } };
                expect(applyStoryRegex(sentence, [oldStored], stage).text).toBe(result.text);
            }
        }
    });

    it('does not guess semantics or rewrite imported quantity-matching expressions', () => {
        const { rules: [rule] } = parseStoryRegexImport(JSON.stringify({
            name: '用户的任意表达规则', category: '随意分组',
            pattern: '(两把雨伞|三块玻璃|半瓶墨水|像玻璃一样)',
            enabled: true, replacement: '', applyOnDisplay: true,
        }));
        expect(rule.source?.smartFilter).toBeUndefined();
        expect(rule.pattern).toBe('(两把雨伞|三块玻璃|半瓶墨水|像玻璃一样)');
        const input = '买了两把雨伞，拾起三块玻璃，又倒出半瓶墨水。他的心像玻璃一样。';
        const result = applyStoryRegex(input, [rule], 'display');
        expect(result.text).toBe('买了，拾起，又倒出。他的心。');
        expect(result.matches).toBe(4);
    });

    it('keeps original structural cleanup and does not add instructions on import', () => {
        const raw = [
            { name: '自带结构清理', pattern: '<ooc>[\\s\\S]*?</ooc>', flags: 'g',
                replacement: '', applyOnDisplay: true, applyOnPrompt: true, aiPrompt: '' },
            { name: '短词正则', pattern: '翡翠', replacement: '', applyOnDisplay: true,
                aiPrompt: '' },
        ];
        const { rules } = parseStoryRegexImport(JSON.stringify(raw));
        expect(rules[0].source?.smartFilter).toBeUndefined();
        expect(rules[1].source?.smartFilter).toBeUndefined();
        expect(applyStoryRegex('正文<ooc>隐藏</ooc>', [rules[0]], 'display').text).toBe('正文');
        expect(applyStoryRegex('一颗翡翠', [rules[1]], 'display').text).toBe('一颗');
        expect(rules.map(rule => rule.instruction)).toEqual(['', '']);
    });

    it('旧版已保存且缺少来源标记的任意导入规则，无需重导入即可本地过滤', () => {
        const parsed = parseStoryRegexImport(JSON.stringify({
            name: '原版自定义规则', category: '旧作者自定义',
            pattern: '(像玻璃一样|玻璃|两把雨伞)', flags: 'g',
            replacement: '', applyOnDisplay: true, applyOnPrompt: true,
            aiPrompt: '',
        })).rules[0];
        const legacy = {
            ...parsed,
            importGroup: '旧版文件A.json',
            source: { category: undefined, originalRule: undefined, smartFilter: undefined },
        };
        const restored = readStoryRegexRules(JSON.stringify([legacy]))[0];
        expect(restored.id).toBe(legacy.id);
        expect(restored.enabled).toBe(true);
        expect(restored.source?.smartFilter).toBeUndefined();
        for (const stage of ['display', 'history'] as const) {
            const result = applyStoryRegex('拿起玻璃，带上两把雨伞。他的心像玻璃一样。', [restored], stage);
            expect(result.text).toBe('拿起，带上。他的心。');
            expect(result.matches).toBe(3);
        }
        for (const savedFlag of [true, false]) {
            const stored = { ...restored, source: { ...restored.source, smartFilter: savedFlag } };
            expect(applyStoryRegex('拿起玻璃', [stored], 'display').text).toBe('拿起');
        }
    });

    it('旧数据库缺少中性可选字段可读取，丢失原版格式指令时不会凭空生成', () => {
        const parsed = parseStoryRegexImport(JSON.stringify({
            name: '旧版导入的词语规则', pattern: '珊瑚|像珊瑚一样',
            applyOnDisplay: true, applyOnPrompt: true, aiPrompt: '',
        })).rules[0];
        const { presetId: _preset, instruction: _instruction, flags: _flags, ...old } = parsed;
        const [restored] = readStoryRegexRules(JSON.stringify([old]));
        expect(restored).toMatchObject({ id: parsed.id, presetId: '', instruction: '', flags: 'g' });
        expect(restored.source?.originalRule).toBeDefined();
        expect(applyStoryRegex('像珊瑚一样', [restored], 'display').text).toBe('');
        expect(applyStoryRegex('带来了珊瑚', [restored], 'display').text).toBe('带来了');
    });

    it('重新导入旧版缺省 source 字段不会重复，同时保留旧规则开关和旧 ID', () => {
        const original = parseStoryRegexImport(JSON.stringify({
            name: '旧版词语保护', pattern: '(像钥匙一样|钥匙)', flags: 'g',
            applyOnDisplay: true, applyOnPrompt: false, replacement: '',
        })).rules[0];
        const old: typeof original = {
            ...original,
            enabled: false,
            importGroup: '旧版文件.json',
            source: { category: undefined, originalRule: undefined },
        };
        const newer = {
            ...original, id: 'reimport-must-not-insert',
            importGroup: '旧版文件.json',
        };
        const first = mergeStoryRegexImport([old], [newer], '');
        expect(first.added).toBe(0);
        expect(first.rules).toHaveLength(1);
        expect(first.rules[0].id).toBe(old.id);
        expect(first.rules[0].enabled).toBe(false);
        expect(first.rules[0].source?.originalRule).toBeDefined();
        expect(mergeStoryRegexImport(first.rules, [newer], '').added).toBe(0);
    });

});
