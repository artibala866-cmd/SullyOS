import { describe, expect, it } from 'vitest';
import {
    buildBareTheaterActorContext,
    compileStoryPreset,
    parseStoryDisplayBlocks,
    parseStoryTheaterPreset,
} from './storyTheater';
import { convertSillyTavernChatPreset, expandSillyTavernContextMacros, expandSillyTavernPromptText, extractSillyTavernStoryContent, squashAdjacentSystemMessages } from './storySillyTavernImport';

const tavern = {
    temperature: 1.05,
    top_p: 0.96,
    frequency_penalty: 0.6,
    presence_penalty: 0.5,
    openai_max_tokens: 50000,
    prompts: [
        { identifier: 'off', name: '关闭项', role: 'system', enabled: true, content: '绝不能发送' },
        { identifier: 'chatHistory', name: '对话', role: 'system', marker: true },
        { identifier: 'main', name: '核心', role: 'system', enabled: false, content: '核心 {{char}} {{user}}' },
        { identifier: 'charDescription', name: '角色资料', role: 'system', marker: true },
        { identifier: 'charPersonality', name: '性格', role: 'system', marker: true },
        { identifier: 'personaDescription', name: '用户身份', role: 'system', marker: true },
        { identifier: 'worldInfoBefore', name: '前世界书', role: 'system', marker: true },
        { identifier: 'worldInfoAfter', name: '后世界书', role: 'system', marker: true },
        { identifier: 'dialogueExamples', name: '例子', role: 'system', marker: true },
        { identifier: 'scenario', name: '剧情', role: 'system', marker: true },
        { identifier: 'vars', name: '设置', role: 'system', content: '{{setvar::color::蓝色}}' },
        { identifier: 'user-rule', name: '变量规则', role: 'user', content: '天空：{{getvar::color}} {{// 注释}}' },
        { identifier: 'chat-depth', name: '聊天深度', role: 'system', content: '深层提示词', injection_position: 1, injection_depth: 1, injection_order: 100 },
        { identifier: 'after-user', name: '历史之后', role: 'system', content: '尾部提醒', injection_position: 1, injection_depth: 0, injection_order: 10 },
        { identifier: 'outside', name: '尚未加入排序的提示词', role: 'system', enabled: true, content: '备用内容' },
    ],
    prompt_order: [
        { character_id: 100001, order: [
            { identifier: 'worldInfoBefore', enabled: true },
            { identifier: 'main', enabled: true },
            { identifier: 'charDescription', enabled: true },
            { identifier: 'charPersonality', enabled: true },
            { identifier: 'personaDescription', enabled: true },
            { identifier: 'scenario', enabled: true },
            { identifier: 'worldInfoAfter', enabled: true },
            { identifier: 'dialogueExamples', enabled: true },
            { identifier: 'off', enabled: false },
            { identifier: 'vars', enabled: true },
            { identifier: 'user-rule', enabled: true },
            { identifier: 'chatHistory', enabled: true },
            { identifier: 'chat-depth', enabled: true },
            { identifier: 'after-user', enabled: true },
        ] },
    ],
    assistant_prefill: '<scene>',
    squash_system_messages: true,
    extensions: {
        regex_scripts: [{ scriptName: 'erase', disabled: false, findRegex: '.*', replaceString: '' }],
        tavern_helper: { scripts: [{ name: 'javascript', enabled: true, content: 'throw new Error("should never execute")' }] },
    },
};

const slots = {
    actors: '全部角色卡', persona: '身份说明', scenario: '剧情设定', worldBefore: '前置世界',
    worldAfter: '后置世界', examples: '对话示例', history: '文字历史',
};

describe('酒馆 Chat Completion JSON 智能适配', () => {
    it('以 prompt_order 为准，保留文字、关闭状态、角色和世界插入位', () => {
        const imported = parseStoryTheaterPreset(JSON.stringify(tavern), '宝宝我是char.json', 19);
        const doc = imported.document;
        expect(imported.name).toBe('宝宝我是char');
        expect(doc.schema).toBe('sullyos.story-preset');
        expect(doc.sourceFormat).toBe('sillytavern');
        expect(doc.squashSystemMessages).toBe(true);
        expect(doc.generation).toEqual({
            temperature: 1.05, topP: 0.96, frequencyPenalty: 0.6, presencePenalty: 0.5, maxTokens: 32000,
        });
        expect(doc.prompts.map(p => p.id).slice(0, 3)).toEqual(['st-worldInfoBefore', 'st-main', 'st-charDescription']);
        expect(doc.prompts.find(p => p.id === 'st-main')).toMatchObject({ enabled: true, content: '核心 {{char}} {{user}}' });
        expect(doc.prompts.find(p => p.id === 'st-off')?.enabled).toBe(false);
        expect(doc.prompts.find(p => p.id === 'st-outside')?.enabled).toBe(false);
        expect(doc.prompts.find(p => p.id === 'st-charDescription')?.marker).toBe('characters');
        expect(doc.prompts.find(p => p.id === 'st-personaDescription')?.marker).toBe('user');
        expect(doc.importWarnings?.join('')).toContain('不会执行');
        expect(JSON.stringify(doc)).not.toContain('should never execute');
    });

    it('编译后真实注入剧情槽位、变量及按历史深度插入，关闭项不影响发送', () => {
        const imported = parseStoryTheaterPreset(JSON.stringify(tavern), '测试.json');
        const result = compileStoryPreset({
            preset: imported, slots, userName: '小雨', characterNames: ['阿蓝'],
            historyMessages: [
                { role: 'user', content: '第一条' },
                { role: 'assistant', content: '第二条' },
            ],
        });
        const texts = result.messages.map(message => message.content);
        expect(texts).toContain('核心 阿蓝 小雨');
        expect(texts).toContain('前置世界');
        expect(texts).toContain('后置世界');
        expect(texts).toContain('全部角色卡');
        expect(texts.filter(t => t === '全部角色卡')).toHaveLength(1);
        expect(texts).toContain('身份说明');
        expect(texts).toContain('剧情设定');
        expect(texts).toContain('对话示例');
        expect(texts).toContain('天空：蓝色');
        expect(texts).not.toContain('绝不能发送');
        expect(texts).not.toContain('备用内容');
        expect(texts.indexOf('深层提示词')).toBeGreaterThan(texts.indexOf('第二条'));
        expect(result.afterLatestUser).toEqual([{ role: 'system', content: '尾部提醒' }]);
        expect(result.assistantPrefill?.content).toBe('<scene>');
    });

    it('变量按当前启用状态计算，重新编辑开关无需重新导入', () => {
        const imported = parseStoryTheaterPreset(JSON.stringify(tavern), '测试.json');
        const disabled = { ...imported, document: {
            ...imported.document,
            prompts: imported.document.prompts.map(p => p.id === 'st-vars' ? { ...p, enabled: false } : p),
        } };
        const messages = compileStoryPreset({ preset: disabled, slots, userName: '小雨', characterNames: ['阿蓝'] }).messages;
        expect(messages.some(m => m.content.includes('天空：蓝色'))).toBe(false);
        expect(messages.some(m => m.content === '天空：')).toBe(true);
    });

    it('只解释白名单变量，不执行输入的脚本；原生 JSON 也可往返导入', () => {
        const variables = new Map<string, string>();
        expect(expandSillyTavernPromptText('{{setvar::x::1}}a{{getvar::x}}', variables)).toBe('a1');
        expect(expandSillyTavernPromptText('<script>alert(1)</script>', variables)).toBe('<script>alert(1)</script>');
        const imported = parseStoryTheaterPreset(JSON.stringify(tavern), '测试.json');
        const native = parseStoryTheaterPreset(JSON.stringify(imported.document), '转换后.json');
        expect(native.document.sourceFormat).toBe('sillytavern');
        expect(native.document.squashSystemMessages).toBe(true);
        expect(native.document.prompts.map(p => p.id)).toEqual(imported.document.prompts.map(p => p.id));
        expect(native.document.prompts.find(p => p.id === 'st-chat-depth')?.injection?.depth).toBe(1);
    });

    it('关闭全部酒馆条目仍可导入编辑，不会意外开启提示词', () => {
        const emptyActive = {
            ...tavern,
            temperature: null,
            top_p: null,
            prompt_order: [{ character_id: 100001, order: tavern.prompt_order[0].order.map(item => ({
                ...item, enabled: false,
            })) }],
        };
        const doc = parseStoryTheaterPreset(JSON.stringify(emptyActive), '停用中.json').document;
        expect(doc.prompts.every(item => !item.enabled)).toBe(true);
        expect(doc.prompts).toHaveLength(tavern.prompts.length);
        expect(doc.generation.temperature).toBe(0.9);
        expect(doc.generation.topP).toBe(1);
        expect(compileStoryPreset({ preset: { id: 'off', name: '停用', format: 'sullyos-story-preset',
            createdAt: 1, updatedAt: 1, document: doc }, slots, userName: '你', characterNames: ['角色'] }).messages)
            .toHaveLength(0);
    });

    it('大型 373 条酒馆预设无丢项，启用 104 条且保持排序与文字', () => {
        const prompts = Array.from({ length: 373 }, (_, i) => ({
            identifier: `entry-${i}`, name: `原始条目${i}`, role: 'system',
            content: `段落${i}：保留文字、标点与 {{char}}`,
        }));
        const order = prompts.map((entry, i) => ({ identifier: entry.identifier, enabled: i < 104 }));
        const doc = parseStoryTheaterPreset(JSON.stringify({
            prompts, prompt_order: [{ character_id: 100001, order }],
        }), '大预设.json').document;
        expect(doc.prompts).toHaveLength(373);
        expect(doc.prompts.filter(item => item.enabled)).toHaveLength(104);
        expect(doc.prompts[0].content).toBe('段落0：保留文字、标点与 {{char}}');
        expect(doc.prompts[372].content).toBe('段落372：保留文字、标点与 {{char}}');
        expect(doc.prompts[104].enabled).toBe(false);
    });

    it('仅在酒馆显式开启时合并相邻系统消息，保持角色与历史边界', () => {
        const input = [
            { role: 'system', content: '原规则一' },
            { role: 'system', content: '原规则二' },
            { role: 'user', content: '用户上一条' },
            { role: 'assistant', content: '角色回答' },
            { role: 'system', content: '新规则' },
            { role: 'system', content: '本轮约束' },
            { role: 'user', content: '最新输入' },
        ] as const;
        const result = squashAdjacentSystemMessages([...input]);
        expect(result.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'system', 'user']);
        expect(result[0].content).toBe('原规则一\\n\\n原规则二'.replaceAll('\\n', '\n'));
        expect(result[3].content).toContain('新规则\n\n本轮约束');
        expect(input[0].content).toBe('原规则一');
    });

    it('酒馆角色描述槽位读取原有角色档案的 description，原生预设保持原样', () => {
        const actor = {
            id: 'c1', name: '林澈', description: '有一颗蓝色纽扣的深色大衣',
            systemPrompt: '性格安静、谨慎', worldview: '雨中的城市',
        } as any;
        const nativeContext = buildBareTheaterActorContext(actor);
        const tavernContext = buildBareTheaterActorContext(actor, true);
        expect(nativeContext).not.toContain('有一颗蓝色纽扣');
        expect(tavernContext).toContain('有一颗蓝色纽扣');
        expect(tavernContext).toContain('性格安静、谨慎');
        const imported = parseStoryTheaterPreset(JSON.stringify(tavern), '真实角色.json');
        const compiled = compileStoryPreset({ preset: imported, slots: {
            actors: tavernContext, persona: '用户身份', scenario: '雨夜',
            worldBefore: '', worldAfter: '', history: '',
        }, userName: '小雨', characterNames: ['林澈'] });
        expect(compiled.messages.map(m => m.content).join('\\n')).toContain('有一颗蓝色纽扣');
        expect(compiled.messages.filter(m => m.content.includes('有一颗蓝色纽扣'))).toHaveLength(1);
    });

    it('酒馆思考区完整保存并可展开查看，正文和附录独立显示，原生解析不变', () => {
        const response = '<thinking>场景确认：必须读当前输入</thinking>\n<content>雨点落在玻璃上。</content>\n<details data-info="archive"><summary>剧情摘要</summary>雨夜</details>';
        const blocks = parseStoryDisplayBlocks(response, true);
        expect(blocks.map(block => block.kind)).toEqual(['thinking', 'story', 'tavern-extra']);
        expect(blocks[0].text).toContain('场景确认：必须读当前输入');
        expect(blocks[1].text).toBe('雨点落在玻璃上。');
        expect(blocks[2].text).toContain('剧情摘要');
        expect(blocks[2].title).toBe('剧情摘要');
        expect(response).toContain('<thinking>');
        // Native presets keep their existing parser and display behavior.
        expect(parseStoryDisplayBlocks(response).some(block => block.kind === 'thinking')).toBe(false);
    });

    it('酒馆专用 API 提取不再误删 thinking，兼容独立 reasoning 字段和模型多段返回', () => {
        const inText = { choices: [{ message: {
            content: '<thinking>规划人物行动</thinking><content>雨停了。</content>',
        } }] };
        expect(extractSillyTavernStoryContent(inText)).toBe('<thinking>规划人物行动</thinking><content>雨停了。</content>');
        const separated = { choices: [{ message: {
            content: '<content>角色推开门。</content>', reasoning_content: '先确认身份再写剧情',
        } }] };
        const actual = extractSillyTavernStoryContent(separated);
        expect(actual).toContain('<thinking>先确认身份再写剧情</thinking>');
        expect(actual).toContain('<content>角色推开门。</content>');
        expect(parseStoryDisplayBlocks(actual, true).map(item => item.kind)).toEqual(['thinking', 'story']);
        const array = { choices: [{ message: { content: [
            { type: 'thinking', thinking: '观察周围线索' },
            { type: 'text', text: '<content>街灯亮了。</content>' },
        ] } }] };
        expect(parseStoryDisplayBlocks(extractSillyTavernStoryContent(array), true).map(item => item.kind))
            .toEqual(['thinking', 'story']);
        expect(parseStoryDisplayBlocks('<think>完整过程</think><content>剧情</content>', true).map(item => item.kind))
            .toEqual(['thinking', 'story']);
    });

    it('{{char}} 和 {{user}} 在运行时按当前角色/当前档案动态解析', () => {
        const renamePreset = parseStoryTheaterPreset(JSON.stringify({
            prompts: [
                { identifier: 'name', role: 'system', content: '角色：{{char}}，用户：{{USER}}，兼容：{{ char }} / <BOT> / <USER>' },
                { identifier: 'body', role: 'user', content: '与 {{user}} 和 {{Char}} 互动，<CHAR> 也要被替换。' },
            ],
            prompt_order: [{ character_id: 100001, order: [
                { identifier: 'name', enabled: true }, { identifier: 'body', enabled: true },
            ] }],
        }), '名字宏.json');
        const opts = { preset: renamePreset, slots, historyMessages: [] };
        const first = compileStoryPreset({ ...opts, userName: '江岚', characterNames: ['林澈'] }).messages;
        const second = compileStoryPreset({ ...opts, userName: '小星', characterNames: ['沈远'] }).messages;
        expect(first.some(message => message.content.includes('角色：林澈，用户：江岚'))).toBe(true);
        expect(first.some(message => message.content.includes('林澈 / 林澈 / 江岚'))).toBe(true);
        expect(first.some(message => message.content.includes('与 江岚 和 林澈 互动'))).toBe(true);
        expect(second.some(message => message.content.includes('角色：沈远，用户：小星'))).toBe(true);
        expect(second.map(m => m.content).join(' ')).not.toContain('江岚');
        expect(second.map(m => m.content).join(' ')).not.toContain('林澈');
    });

    it('角色字段、历史与当前输入宏使用糯米机实时数据，未知宏不乱替换', () => {
        const expanded = expandSillyTavernContextMacros('卡：{{description}} 性格：{{PERSONALITY}} 你：{{persona}} 输入：{{input}}\n历史：{{lastUserMessage}}\n{{newline}}! {{futureExtension}}', {
            description: '蓝色衣服', personality: '不爱说谎', persona: '旅行者',
            input: '打开门', lastUserMessage: '早上好',
        });
        expect(expanded).toContain('卡：蓝色衣服 性格：不爱说谎 你：旅行者 输入：打开门');
        expect(expanded).toContain('历史：早上好');
        expect(expanded).toContain('{{futureExtension}}');
        expect(expanded).toContain('\n\n!');
    });

    it('启用的 setvar 富文本规则直接参与发送；初始化空值与关闭选项不误生效', () => {
        const rich = {
            prompts: [
                { identifier: 'defaults', role: 'system', content: '{{setvar::视角:: }}' },
                { identifier: 'selected', role: 'system', content: '{{setvar::视角::\n<rule name="视角">必须遵守角色知识边界</rule>\n}}' },
                { identifier: 'disabled', role: 'system', content: '{{setvar::被关闭::\n<rule>禁止启用的条目</rule>\n}}' },
                { identifier: 'chatHistory', role: 'system', marker: true },
            ],
            prompt_order: [{ character_id: 100001, order: [
                { identifier: 'defaults', enabled: true },
                { identifier: 'selected', enabled: true },
                { identifier: 'disabled', enabled: false },
                { identifier: 'chatHistory', enabled: true },
            ] }],
        };
        const imported = parseStoryTheaterPreset(JSON.stringify(rich), '变量配置.json');
        const messages = compileStoryPreset({ preset: imported, slots, userName: '小雨',
            characterNames: ['阿蓝'], historyMessages: [] }).messages.map(msg => msg.content);
        expect(messages).toContain('<rule name="视角">必须遵守角色知识边界</rule>');
        expect(messages.join('\n')).not.toContain('禁止启用的条目');
        expect(messages.join('\n')).not.toContain('{{setvar');
        expect(imported.document.prompts.find(p => p.id === 'st-selected')?.content).toContain('{{setvar');
    });

    it('带自定义 XML 根标签的酒馆规则不会因无法运行脚本而丢失', () => {
        const variables = new Map<string, string>();
        const source = '{{setvar::感官::<five_senses_intimate>按人物设定描写环境</five_senses_intimate>}}';
        expect(expandSillyTavernPromptText(source, variables, new Set())).toBe('<five_senses_intimate>按人物设定描写环境</five_senses_intimate>');
        expect(variables.get('感官')).toContain('按人物设定');
        expect(expandSillyTavernPromptText(source, new Map(), new Set(['感官']))).toBe('');
    });

    it('当启用 getvar 明确引用变量时，在引用位置只插入一次', () => {
        const rich = {
            prompts: [
                { identifier: 'vars', role: 'system', content: '{{setvar::节奏::<rule>跟随上下文自然推进</rule>}}' },
                { identifier: 'reference', role: 'system', content: '本轮启用：{{getvar::节奏}}' },
            ],
            prompt_order: [{ character_id: 100001, order: [
                { identifier: 'vars', enabled: true },
                { identifier: 'reference', enabled: true },
            ] }],
        };
        const imported = parseStoryTheaterPreset(JSON.stringify(rich), '变量引用.json');
        const messages = compileStoryPreset({ preset: imported, slots: { ...slots, worldBefore: '' }, userName: '小雨',
            characterNames: ['阿蓝'] }).messages.map(msg => msg.content);
        expect(messages).toEqual(['本轮启用：<rule>跟随上下文自然推进</rule>']);
    });

    it('纯文本 Chat Completion 缺少 prompt_order 仍保留开关与文本', () => {
        const imported = parseStoryTheaterPreset(JSON.stringify({
            prompts: [
                { identifier: 'intro', role: 'system', content: '<instructions>只按当前背景续写</instructions>' },
                { identifier: 'off', role: 'system', enabled: false, content: '明确关闭的旧规则' },
                { identifier: 'notes', role: 'assistant', content: '无需名称宏的纯文字' },
            ],
        }), '纯文本预设.json');
        expect(imported.document.prompts.map(prompt => prompt.enabled)).toEqual([true, false, true]);
        expect(imported.document.importWarnings?.join('')).toContain('没有 prompt_order');
        const content = compileStoryPreset({ preset: imported, slots: { ...slots, worldBefore: '' },
            userName: '用户', characterNames: ['角色'] }).messages.map(m => m.content).join('\n');
        expect(content).toContain('<instructions>只按当前背景续写</instructions>');
        expect(content).toContain('无需名称宏的纯文字');
        expect(content).not.toContain('明确关闭的旧规则');
    });

    it('识别没有 marker:true 的标准空白占位和字符串型聊天深度', () => {
        const imported = parseStoryTheaterPreset(JSON.stringify({
            prompts: [
                { identifier: 'charDescription', role: 'system', content: '' },
                { identifier: 'chatHistory', role: 'system', content: '' },
                { identifier: 'scenario', role: 'system', content: '自定义原文，不是占位' },
                { identifier: 'deep', role: 'user', content: '历史内指令', injection_position: '1', injection_depth: 1 },
            ],
            prompt_order: [{ character_id: 100000, order: ['charDescription', 'chatHistory', 'scenario', 'deep']
                .map(identifier => ({ identifier, enabled: true })) }],
        }), '旧版预设.json');
        expect(imported.document.prompts[0].marker).toBe('characters');
        expect(imported.document.prompts[1].marker).toBe('history');
        expect(imported.document.prompts[2].marker).toBeUndefined();
        expect(imported.document.prompts[3].injection?.depth).toBe(1);
        const result = compileStoryPreset({ preset: imported, slots: { ...slots, worldBefore: '' },
            historyMessages: [{ role: 'user', content: '旧输入' }],
            userName: '用户', characterNames: ['角色'] });
        expect(result.messages.some(m => m.content === '自定义原文，不是占位')).toBe(true);
        expect(result.messages.some(m => m.content === '全部角色卡')).toBe(true);
    });

    it('描述与性格两个槽位均启用时各自发送，关掉一个时仍有完整角色资料', () => {
        const imported = parseStoryTheaterPreset(JSON.stringify({
            prompts: [
                { identifier: 'charPersonality', role: 'assistant', marker: true },
                { identifier: 'charDescription', role: 'system', marker: true },
            ],
            prompt_order: [{ character_id: 100001, order: [
                { identifier: 'charPersonality', enabled: true },
                { identifier: 'charDescription', enabled: true },
            ] }],
            personality_format: '<personality>{{personality}}</personality>',
        }), '两个角色槽.json');
        const boundSlots = { ...slots, worldBefore: '',
            tavernDescription: '描述原文A', tavernPersonality: '性格原文B' };
        const full = compileStoryPreset({ preset: imported, slots: boundSlots,
            userName: '用户', characterNames: ['演员'] }).messages;
        expect(full.map(m => m.content)).toEqual(['<personality>性格原文B</personality>', '描述原文A']);
        expect(full.map(m => m.role)).toEqual(['assistant', 'system']);
        const disabled = { ...imported, document: { ...imported.document,
            prompts: imported.document.prompts.map(prompt => prompt.id === 'st-charDescription'
                ? { ...prompt, enabled: false } : prompt) } };
        const single = compileStoryPreset({ preset: disabled, slots: boundSlots,
            userName: '用户', characterNames: ['演员'] }).messages;
        expect(single.map(m => m.content)).toEqual(['全部角色卡']);
    });

    it('不用名称宏的 {0} 世界书格式和元数据会保留、发送、导出再导入', () => {
        const imported = parseStoryTheaterPreset(JSON.stringify({
            prompts: [
                { identifier: 'worldInfoBefore', marker: true, role: 'system' },
                { identifier: 'scenario', marker: true, role: 'system' },
                { identifier: 'chatHistory', marker: true, role: 'system' },
            ],
            prompt_order: [{ character_id: 100001, order: [
                { identifier: 'worldInfoBefore', enabled: true },
                { identifier: 'scenario', enabled: true },
                { identifier: 'chatHistory', enabled: true },
            ] }],
            wi_format: '<lore>{0}</lore>', scenario_format: '<scene>{{scenario}}</scene>',
            new_chat_prompt: '[开始本段对话]', top_k: 40, openai_max_context: 240000,
            extensions: { regex_scripts: [{ disabled: false, name: '不执行的扩展正则' }] },
        }), '模板变体.json');
        const exported = parseStoryTheaterPreset(JSON.stringify(imported.document), '糯米机导出.json');
        expect(exported.document.tavernFormats?.worldInfo).toBe('<lore>{0}</lore>');
        expect(exported.document.tavernOptions?.top_k).toBe(40);
        expect(exported.document.tavernOptions?.openai_max_context).toBe(240000);
        expect(JSON.stringify(exported.document)).not.toContain('不执行的扩展正则');
        const contents = compileStoryPreset({
            preset: exported, slots: { ...slots, worldBefore: '前置世界', worldAfter: '' },
            historyMessages: [{ role: 'user', content: '你好' }],
            userName: '用户', characterNames: ['角色'],
        }).messages.map(m => m.content);
        expect(contents).toContain('<lore>前置世界</lore>');
        expect(contents).toContain('<scene>剧情设定</scene>');
        expect(contents).toContain('[开始本段对话]');
        expect(contents).toContain('你好');
    });

    it('时间、模型名、变量简写及基础 if/else 宏安全展开，未知表达式保留', () => {
        const variables = new Map<string, string>();
        const first = expandSillyTavernPromptText('{{setvar::天气::晴天}} 天气：{{.天气}}', variables);
        expect(first).toBe(' 天气：晴天');
        const raw = [
            '日期={{isodate}} 时间={{isotime}} 模型={{model}}',
            '{{#if description}}有角色：{{description}}{{else}}无角色{{/if}}',
            '{{if !persona}}用户设定为空{{else}}用户设定存在{{/if}}',
            '{{if .天气}}天气变量有值{{/if}}',
            '{{if this_unknown_macro}}未知语义应原样保留{{/if}}',
        ].join('\n');
        const output = expandSillyTavernContextMacros(raw, {
            now: new Date(2026, 10, 7, 13, 5),
            model: 'gemini-model', description: '深蓝外套', persona: '', variables,
        });
        expect(output).toContain('日期=2026-11-07 时间=13:05 模型=gemini-model');
        expect(output).toContain('有角色：深蓝外套');
        expect(output).not.toContain('无角色');
        expect(output).toContain('用户设定为空');
        expect(output).not.toContain('用户设定存在');
        expect(output).toContain('天气变量有值');
        expect(output).toContain('{{if this_unknown_macro}}未知语义应原样保留{{/if}}');
    });

    it('嵌套条件按内层优先展开且不会丢弃未实现的指令', () => {
        const output = expandSillyTavernContextMacros(
            '{{if description}}A{{if personality}}B{{else}}C{{/if}}D{{/if}} {{pick::红::蓝}}',
            { description: '在场', personality: '' },
        );
        expect(output).toBe('ACD {{pick::红::蓝}}');
    });

    it('不会把酒馆 Instruct 和 Context 文本补全模板伪装成 Chat Completion 成功导入', () => {
        expect(() => parseStoryTheaterPreset(JSON.stringify({
            input_sequence: '### Instruction:', output_sequence: '### Response:',
            system_sequence: '### System:',
        }), 'Instruct.json')).toThrow('文本补全模板');
        expect(() => parseStoryTheaterPreset(JSON.stringify({
            story_string: '{{#if description}}{{description}}{{/if}}',
            chat_start: '---',
        }), 'Context.json')).toThrow('文本补全模板');
    });

    it('拒绝其它 completion JSON 与空排序伪装', () => {
        expect(() => parseStoryTheaterPreset(JSON.stringify({ prompts: [], prompt_order: [] }), 'empty.json')).toThrow();
        expect(() => parseStoryTheaterPreset(JSON.stringify({ model: 'x', messages: [] }), 'arbitrary.json')).toThrow();
        expect(() => convertSillyTavernChatPreset({ prompts: [], prompt_order: [] }, 'empty')).toThrow();
    });
});
