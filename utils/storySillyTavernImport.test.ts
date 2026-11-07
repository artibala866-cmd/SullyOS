import { describe, expect, it } from 'vitest';
import {
    buildBareTheaterActorContext,
    compileStoryPreset,
    buildStoryIdentityGuard,
    buildTavernNativeOverrideMessages,
    buildStoryMiniTheaterReminder,
    getActiveStoryMiniTheaterPrompt,
    parseStoryDisplayBlocks,
    parseStoryTheaterPreset,
} from './storyTheater';
import { convertSillyTavernChatPreset, detectTavernNativeControls, expandSillyTavernContextMacros, expandSillyTavernPromptText, extractSillyTavernStoryContent, squashAdjacentSystemMessages } from './storySillyTavernImport';

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

    it('酒馆 Continue Nudge 仅在继续时进入请求，多角色使用 group chat header', () => {
        const imported = parseStoryTheaterPreset(JSON.stringify({
            prompts: [{ identifier: 'chatHistory', role: 'system', marker: true }],
            prompt_order: [{ character_id: 100001, order: [{ identifier: 'chatHistory', enabled: true }] }],
            new_chat_prompt: '[单人开始]',
            new_group_chat_prompt: '[多人：{{group}}]',
            continue_nudge_prompt: '[继续 {{user}} 与 {{char}} 的故事，不重复之前回复]',
        }), '继续规则.json');
        const values = { preset: imported, slots: { ...slots, worldBefore: '' },
            userName: '江岚', characterNames: ['林澈', '温璃'],
            historyMessages: [{ role: 'user' as const, content: '上一轮输入' }] };
        const normal = compileStoryPreset(values);
        expect(normal.messages.map(m => m.content)).toContain('[多人：林澈、温璃]');
        expect(normal.continueNudge).toBeUndefined();
        const continued = compileStoryPreset({ ...values, continueRequested: true });
        expect(continued.continueNudge).toEqual({
            role: 'system',
            content: '[继续 江岚 与 林澈、温璃 的故事，不重复之前回复]',
        });
    });

    it('lastMessage/lastUserMessage 绑定本轮真实输入，Continue 不把调度词假装为用户历史', () => {
        const imported = parseStoryTheaterPreset(JSON.stringify({
            prompts: [{ identifier: 'status', role: 'system',
                content: '末句：{{lastMessage}}｜用户：{{lastUserMessage}}｜角色：{{lastCharMessage}}' }],
            prompt_order: [{ character_id: 100001,
                order: [{ identifier: 'status', enabled: true }] }],
        }), '聊天宏.json');
        const historyMessages = [
            { role: 'user' as const, content: '较早输入' },
            { role: 'assistant' as const, content: '上一轮角色回复' },
        ];
        const input = { preset: imported, slots: { ...slots, worldBefore: '' },
            userName: '用户', characterNames: ['角色'], historyMessages };
        const current = compileStoryPreset({ ...input, currentInput: '刚刚说的话',
            currentInputIsNewUserMessage: true }).messages.map(m => m.content).join('\n');
        expect(current).toContain('末句：刚刚说的话｜用户：刚刚说的话｜角色：上一轮角色回复');
        const continuation = compileStoryPreset({ ...input, currentInput: '系统内部继续命令',
            currentInputIsNewUserMessage: false }).messages.map(m => m.content).join('\n');
        expect(continuation).toContain('末句：上一轮角色回复｜用户：较早输入｜角色：上一轮角色回复');
        expect(continuation).not.toContain('系统内部继续命令');
    });


    it('冥王星变体：中文本地变量按启用顺序读取，缺失赋值会明确告警', () => {
        const imported = parseStoryTheaterPreset(JSON.stringify({
            prompts: [
                { identifier: 'define', role: 'system', content: '{{setvar::主要语言::简体中文}}' },
                { identifier: 'read', role: 'system', content: '语言={{getvar::主要语言}} 未定义={{getvar::不存在的配置}}' },
            ],
            prompt_order: [{ character_id: 100001, order: [
                { identifier: 'define', enabled: true },
                { identifier: 'read', enabled: true },
            ] }],
        }), '冥王星结构回归.json');
        expect(imported.document.importWarnings?.join('')).toContain('不存在的配置');
        const generated = compileStoryPreset({ preset: imported,
            slots: { ...slots, worldBefore: '' }, userName: '用户', characterNames: ['角色'] });
        expect(generated.messages.map(m => m.content)).toContain('语言=简体中文 未定义=');
    });

    it('Akover 变体：逗号格式 random 正常选择，作者写的中文 {{模板文本}} 不能被当未知宏删除', () => {
        const variables = new Map<string, string>();
        expect(expandSillyTavernPromptText(
            '镜头 {{random::first, second,final}}；{{角色名字}}', variables, undefined, new Map(), () => 0,
        )).toBe('镜头 first；{{角色名字}}');
        expect(expandSillyTavernPromptText(
            '{{random::first::second::final}}', new Map(), undefined, new Map(), () => 0.99,
        )).toBe('final');
        expect(expandSillyTavernPromptText(
            '{{//作者注释}}正文', new Map(),
        )).toBe('正文');
    });

    it('Mur 变体：旧版 lastChatMessage 在 Continue Nudge 中使用角色原文，普通发送不多发', () => {
        const imported = parseStoryTheaterPreset(JSON.stringify({
            prompts: [{ identifier: 'chatHistory', role: 'system', marker: true }],
            prompt_order: [{ character_id: 100001,
                order: [{ identifier: 'chatHistory', enabled: true }] }],
            continue_nudge_prompt: '续写这条角色消息：{{lastChatMessage}}',
            tool_reasoning_mode: 'disabled',
        }), 'Mur 旧宏结构回归.json');
        const args = { preset: imported, slots: { ...slots, worldBefore: '' },
            userName: '用户', characterNames: ['鹿鹿'],
            historyMessages: [
                { role: 'user' as const, content: '用户最后一句' },
                { role: 'assistant' as const, content: '角色上一段原文' },
            ] };
        const normal = compileStoryPreset(args);
        expect(normal.continueNudge).toBeUndefined();
        const continued = compileStoryPreset({ ...args, continueRequested: true });
        expect(continued.continueNudge?.content).toBe('续写这条角色消息：角色上一段原文');
        expect(continued.continueNudge?.content).not.toContain('{{lastChatMessage}}');
    });

    it('Janus 变体：全局变量只在本次请求共享，随机池生效，小写 <user> 标签不被偷换成名字', () => {
        const imported = parseStoryTheaterPreset(JSON.stringify({
            prompts: [
                { identifier: 'style', role: 'system', content:
                    '{{setglobalvar::literary_style::<Dynamic_Writing_Style>}}<Dynamic_Writing_Style>作者池：{{random::甲::乙::丙}}</Dynamic_Writing_Style>' },
                { identifier: 'instruction', role: 'system', content:
                    '把{{getglobalvar::literary_style}}用于<user>的故事；{{char}}与<USER>可动态识别' },
            ],
            prompt_order: [{ character_id: 100001, order: [
                { identifier: 'style', enabled: true },
                { identifier: 'instruction', enabled: true },
            ] }],
            squash_system_messages: true,
        }), 'Janus 全局变量回归.json');
        expect(imported.document.importWarnings?.join('')).toContain('globalvar');
        const compile = (userName: string) => compileStoryPreset({ preset: imported,
            slots: { ...slots, worldBefore: '' }, userName, characterNames: ['剧情角色'] });
        const first = compile('甲用户').messages.map(m => m.content).join('\n');
        const second = compile('乙用户').messages.map(m => m.content).join('\n');
        expect(first).toMatch(/作者池：(甲|乙|丙)/);
        expect(first).not.toContain('{{random');
        expect(first).not.toContain('{{setglobalvar');
        expect(first).toContain('把<Dynamic_Writing_Style>用于<user>的故事');
        expect(first).toContain('剧情角色与甲用户可动态识别');
        expect(second).toContain('剧情角色与乙用户可动态识别');
        expect(second).toContain('<user>');
        expect(imported.document.squashSystemMessages).toBe(true);
        const emptyGlobals = new Map<string, string>();
        expect(expandSillyTavernPromptText('{{getglobalvar::literary_style}}', new Map(), undefined, emptyGlobals)).toBe('');
        expect(emptyGlobals.size).toBe(0);
    });

    it('酒馆正则与 JS 扩展隔离：不执行、不存进剧情预设，仍保留作者启用的小剧场规则并警告', () => {
        const sample = parseStoryTheaterPreset(JSON.stringify({
            prompts: [
                { identifier: 'main', role: 'system', content:
                    '<sidestory><details><summary>小剧场</summary>必须使用 HTML/CSS 美化</details></sidestory>' },
                { identifier: 'chatHistory', marker: true, role: 'system' },
            ],
            prompt_order: [{ character_id: 100001, order: [
                { identifier: 'main', enabled: true }, { identifier: 'chatHistory', enabled: true },
            ] }],
            extensions: {
                regex_scripts: [{
                    scriptName: '测试- HTML 正则美化', disabled: false,
                    findRegex: '<sidestory>([\\s\\S]*)</sidestory>',
                    replaceString: '<iframe src="https://example.com/script"></iframe>',
                    placement: [2], markdownOnly: true, promptOnly: false,
                }],
                tavern_helper: { scripts: [{
                    name: '不执行的脚本', enabled: true,
                    content: 'throw new Error("helper must never run")',
                }] },
            },
        }), 'HTML小剧场带扩展.json');
        const doc = sample.document;
        expect(doc.sourceFormat).toBe('sillytavern');
        expect(doc.importWarnings?.join('\n')).toContain('1 条启用正则');
        expect(doc.importWarnings?.join('\n')).toContain('1 个启用脚本');
        expect(doc.importWarnings?.join('\n')).toContain('小剧场/HTML 排版指令');
        expect(doc.prompts[0].content).toContain('<sidestory>');
        expect(JSON.stringify(doc)).not.toContain('helper must never run');
        expect(JSON.stringify(doc)).not.toContain('https://example.com/script');
        expect(buildStoryMiniTheaterReminder(doc, '用户', ['角色'])).toBe('');
        expect(getActiveStoryMiniTheaterPrompt(doc)).toBeUndefined();
    });

    it('酒馆 HTML 小剧场不会误当原生小剧场或网页执行；文字可归入折叠附录', () => {
        const tavernResponse = [
            '<content>这是正篇。</content>',
            '<sidestory><details><summary>小剧场：纸飞机</summary>',
            '<div class="theater" style="color:red"><b>人物说：</b>你好</div></details></sidestory>',
        ].join('');
        const blocks = parseStoryDisplayBlocks(tavernResponse, true);
        expect(blocks.map(block => block.kind)).toEqual(['story', 'tavern-extra']);
        expect(blocks[0].text).toBe('这是正篇。');
        expect(blocks[1].text).toContain('小剧场：纸飞机');
        expect(blocks[1].text).toContain('你好');
        expect(blocks[1].text).not.toContain('<div');
        expect(blocks.some(block => block.kind === 'theater')).toBe(false);
        const native = parseStoryDisplayBlocks(
            '<mini_theater><mt_title>纸飞机</mt_title><mt_ai><name>角色</name><text>你好</text></mt_ai></mini_theater>',
        );
        expect(native[0].kind).toBe('theater');
        expect(native[0].theater?.messages).toMatchObject([{ name: '角色', text: '你好' }]);
    });

    it('酒馆 <sidestory> 即使没有 details，也只进入折叠附录，不污染剧情正文', () => {
        const blocks = parseStoryDisplayBlocks([
            '<content>雨后的正文。<sidestory>剧场一：',
            '<div style="color:coral"><b>角色</b>：去看电影。</div>',
            '</sidestory>回到正文。</content>',
        ].join(''), true);
        expect(blocks.map(block => block.kind)).toEqual(['story', 'tavern-extra', 'story']);
        expect(blocks[0].text).toBe('雨后的正文。');
        expect(blocks[1].title).toBe('酒馆小剧场');
        expect(blocks[1].text).toContain('去看电影。');
        expect(blocks[1].text).not.toContain('style=');
        expect(blocks[2].text).toBe('回到正文。');
        expect(blocks.every(block => block.kind !== 'theater')).toBe(true);
    });

    it('冥王星的 RandomTheater、Ako 的 writing_interlude 识别为独立文本附录，原生不受影响', () => {
        const raw = [
            '故事开端。',
            '<RandomTheater><details><summary>动物世界番外</summary>小猫喝水。</details></RandomTheater>',
            '<writing_interlude><div class="header">文章标题</div></writing_interlude>',
            '故事继续。',
        ].join('');
        const parsed = parseStoryDisplayBlocks(raw, true);
        expect(parsed.map(block => block.kind)).toEqual(['story', 'tavern-extra', 'tavern-extra', 'story']);
        expect(parsed[1].title).toBe('酒馆随机小剧场');
        expect(parsed[1].text).toContain('小猫喝水。');
        expect(parsed[2].title).toBe('酒馆写作间隙');
        expect(parsed[2].text).toBe('文章标题');
        expect(parsed[3].text).toBe('故事继续。');
        expect(parseStoryDisplayBlocks(raw).every(block => block.kind !== 'tavern-extra')).toBe(true);
    });

    it('HTML 纯视觉标签没有文字时不会当代码执行，但当前可能显示空白，作为剩余兼容风险固定回归', () => {
        const blocks = parseStoryDisplayBlocks(
            '<sidestory><div><img src="https://example.org/image.png" /></div></sidestory>', true,
        );
        expect(blocks.every(block => block.kind !== 'theater')).toBe(true);
        expect(blocks.map(block => block.text).join('')).not.toContain('<img');
    });

    it('拒绝其它 completion JSON 与空排序伪装', () => {
        expect(() => parseStoryTheaterPreset(JSON.stringify({ prompts: [], prompt_order: [] }), 'empty.json')).toThrow();
        expect(() => parseStoryTheaterPreset(JSON.stringify({ model: 'x', messages: [] }), 'arbitrary.json')).toThrow();
        expect(() => convertSillyTavernChatPreset({ prompts: [], prompt_order: [] }, 'empty')).toThrow();
    });

    it('视频默认版参数：四份酒馆导出里的温度、Top P、两项惩罚和输出上限实际映射到请求设置', () => {
        const samples = [
            { title: '冥王星', t: 1, topP: .9, freq: 0, pres: 0, tokens: 60000, effective: 32000 },
            { title: 'Akover', t: 1, topP: .97, freq: .32, pres: .48, tokens: 65535, effective: 32000 },
            { title: 'Mur', t: 1, topP: 1, freq: 0, pres: 0, tokens: 20000, effective: 20000 },
            { title: 'Janus', t: 1.05, topP: .95, freq: .4, pres: .4, tokens: 10000, effective: 10000 },
        ];
        for (const sample of samples) {
            const imported = parseStoryTheaterPreset(JSON.stringify({
                prompts: [{ identifier: 'rule', name: '系统规则', role: 'system', content: '续写角色与用户的故事。' }],
                prompt_order: [{ character_id: 100001, order: [{ identifier: 'rule', enabled: true }] }],
                temperature: sample.t, top_p: sample.topP,
                frequency_penalty: sample.freq, presence_penalty: sample.pres,
                openai_max_tokens: sample.tokens,
            }), sample.title + '.json');
            expect(imported.document.generation).toMatchObject({
                temperature: sample.t, topP: sample.topP, frequencyPenalty: sample.freq,
                presencePenalty: sample.pres, maxTokens: sample.effective,
            });
            const output = compileStoryPreset({ preset: imported,
                slots: { ...slots, worldBefore: '' }, userName: '玩家', characterNames: ['角色'] });
            expect(output.settings).toMatchObject({
                temperature: sample.t, top_p: sample.topP,
                frequency_penalty: sample.freq, presence_penalty: sample.pres, max_tokens: sample.effective,
            });
            if (sample.tokens > 32000) expect(imported.document.importWarnings?.join('\n')).toContain('32000');
        }
    });

    it('作者没有把标题写成小剧场时，也能从正文后的 sidestory 输出合同识别', () => {
        const detected = detectTavernNativeControls([{
            id: 'appendix', name: '附录输出格式', role: 'system', enabled: true,
            content: '正文结束后输出 <sidestory><details>每轮结尾生成独立小剧场</details></sidestory>。',
        }]);
        expect(detected.labels.theater).toBe('作者自定义小剧场');
        expect(detected.inferred.theater).toBeUndefined();
        expect(detectTavernNativeControls([{
            id: 'off', name: '关闭小剧场', role: 'system', enabled: false,
            content: '每轮结尾生成独立小剧场。<sidestory>示例</sidestory>',
        }]).labels.theater).toBeUndefined();
    });

    it('Mur 的 Word_budget 与 bare Chinese 语言识别不会捏造汉字单位或简体选项', () => {
        const detected = detectTavernNativeControls([
            { id: 'language', role: 'system', enabled: true, name: '语言',
                content: '<language_forms>\n language: Chinese.\n</language_forms>' },
            { id: 'length', role: 'system', enabled: true, name: '字数要求',
                content: '<creation_form>\n Word_budget: 900~1000\n</creation_form>' },
            { id: 'off', role: 'system', enabled: false, name: '繁體中文规则',
                content: '正文必须使用繁體中文。' },
        ]);
        expect(detected.labels.language).toBe('中文（简繁未指定）');
        expect(detected.inferred.language).toBeUndefined();
        expect(detected.labels.length).toBe('900–1000（Word_budget，按作者单位）');
        expect(detected.inferred.length).toBeUndefined();
    });

    it('冥王星的 Char 第三人称＋user 第二人称是作者混合视角，不能被内置有限视角抢掉', () => {
        const raw = JSON.stringify({
            prompts: [
                { identifier: 'perspective', name: 'Char视角-TA&你', role: 'system',
                    content: '{{setvar::Perspective::POV: Immersive Third-Person. (He/She & You). 用“你/您”指代<user>，角色使用第三人称。}}' },
                { identifier: 'main', name: '主叙事', role: 'system', content: '{{getvar::Perspective}}' },
            ],
            prompt_order: [{ character_id: 100001, order: [
                { identifier: 'perspective', enabled: true }, { identifier: 'main', enabled: true },
            ] }],
        });
        const imported = parseStoryTheaterPreset(raw, 'Pluto-混合视角.json');
        expect(imported.document.tavernControls?.labels.pov).toContain('混合视角');
        expect(imported.document.tavernControls?.inferred.pov).toBeUndefined();
        const guard = buildStoryIdentityGuard(imported.document, '主角', ['演员']);
        expect(guard).toContain('自定义／混合视角');
        expect(guard).not.toContain('当前启用第三人称有限');
        const result = compileStoryPreset({
            preset: imported, slots: { ...slots, worldBefore: '' },
            userName: '主角', characterNames: ['演员'],
        });
        expect(result.messages.map(m => m.content).join('\n')).toContain('Immersive Third-Person');
        expect(result.nativeOverrideMessages).toEqual([]);
    });

    it('Akover 的规则／正文／我按真实 role 保留，不误改消息顺序或代写权限', () => {
        const raw = JSON.stringify({
            prompts: [
                { identifier: 's', role: 'system', name: '规则', content: '这是系统创作协议。' },
                { identifier: 'u', role: 'user', name: '输入确认', content: '这是作者的用户消息。' },
                { identifier: 'a', role: 'assistant', name: '正文示例', content: '这是作者的助手消息。' },
                { identifier: 'agency', role: 'system', name: '🆖不抢话',
                    content: '不可代替Editor描述{{user}}，禁止代写。' },
            ],
            prompt_order: [{ character_id: 100001, order: [
                { identifier: 's', enabled: true }, { identifier: 'u', enabled: true },
                { identifier: 'a', enabled: true }, { identifier: 'agency', enabled: true },
            ] }],
        });
        const preset = parseStoryTheaterPreset(raw, 'Ako-role.json');
        expect(preset.document.prompts.map(p => p.role)).toEqual(['system', 'user', 'assistant', 'system']);
        expect(preset.document.tavernControls?.inferred.agency).toBe('nmj-v63-user-agency-locked');
        const compiled = compileStoryPreset({ preset,
            slots: { ...slots, worldBefore: '' }, userName: '玩家', characterNames: ['角色'] });
        expect(compiled.messages.slice(0,3).map(m => m.role)).toEqual(['system', 'user', 'assistant']);
    });

    it('真实酒馆写法：自动识别语言、原样数字篇幅、文风与随机小剧场，不捏造不匹配的内置选择', () => {
        const texts = [
            { id: 'style', name: '文风设计', content: '采用电影化写实风格，强调环境、动作与人物性格中的生活质感。'.repeat(6) },
            { id: 'cn', name: '修改语言', content: '{{setvar::主要语言::简体中文}}' },
            { id: 'length', name: '修改字数', content: '{{setvar::正文字数::800-1500字}}' },
            { id: 'theater', name: '随机小剧场', content: '每轮结尾生成一个随机小剧场，保留作者自己的 RandomTheater 标签。' },
            { id: 'other', name: '其他剧情', content: '其他人物使用第三人称，在剧情选项中提供说明，不能据此推断主旁白视角。' },
        ];
        const imported = parseStoryTheaterPreset(JSON.stringify({
            temperature: 1.05, top_p: 0.95, frequency_penalty: 0.4, presence_penalty: 0.3,
            prompts: texts.map(p => ({ identifier: p.id, name: p.name, content: p.content, role: 'system' })),
            prompt_order: [{ character_id: 100001, order: texts.map(p => ({ identifier: p.id, enabled: true })) }],
        }), '冥王星模式测试.json');
        const controls = imported.document.tavernControls!;
        expect(controls.labels).toMatchObject({
            style: '作者电影化文风',
            language: '简体中文',
            length: '800–1500字',
            theater: '作者随机小剧场',
        });
        expect(controls.inferred.language).toBe('nmj-v3-language-cn');
        expect(controls.inferred.theater).toBe('nmj-v3-theater-random');
        expect(controls.inferred.length).toBeUndefined();
        expect(controls.inferred.pov).toBeUndefined();
        expect(imported.document.prompts).toHaveLength(texts.length);
        expect(imported.document.generation).toMatchObject({
            temperature: 1.05, topP: 0.95, frequencyPenalty: 0.4, presencePenalty: 0.3,
        });
    });

    it('Janus 的 pov_user 为第二人称，但 pov_npc 是第三人称：不可错误标成第三人称', () => {
        const controls = detectTavernNativeControls([
            { id: 'user-pov', name: '✍️视角体系', role: 'system', enabled: true,
                content: '<Perspective_System><pov_user>第二人称 {{//可选值：第一/二/三人称}}</pov_user><pov_npc>第三人称</pov_npc></Perspective_System>' },
            { id: 'disabled-pov', name: '第三人称上帝视角', role: 'system', enabled: false,
                content: '<POV>第三人称</POV>' },
        ]);
        expect(controls.inferred.pov).toBe('nmj-v3-pov-second');
    });

    it('Mur 真实第三人称抢话条目必须识别为全自动演绎，而不是误判不抢话', () => {
        const detected = detectTavernNativeControls([{
            id: 'mur-pov', name: '抢话 · 第三人称', role: 'system', enabled: true,
            content: '<multi_perspective_pov> Narrative must unfold from an immersive third-person perspective. ' +
                'Simultaneously describe the dialogue, decisions, and actions of both user and Character. ' +
                'Make major decisions and deliver key dialogue on behalf of the user.</multi_perspective_pov>',
        }]);
        expect(detected.inferred.pov).toBe('nmj-v3-pov-third');
        expect(detected.inferred.agency).toBe('nmj-v63-user-agency-auto');
    });

    it('真正的回放扩写、不复述、不抢话分别匹配内置规则，模糊的旁白不误推断', () => {
        const akover = detectTavernNativeControls([
            { id: 'rp', name: '✅RP转述', role: 'system', enabled: true,
                content: '<转述>读取用户最新输入，从开头重新扩写整个输入场景，随后继续故事。</转述>' },
            { id: 'agency', name: '🆖不抢话', role: 'system', enabled: true,
                content: '不可代替用户执行重大决定，不得替用户台词。' },
        ]);
        expect(akover.inferred.retelling).toBe('nmj-v62-retelling-replay');
        expect(akover.inferred.agency).toBe('nmj-v63-user-agency-locked');
        const direct = detectTavernNativeControls([{ id: 'direct', name: '不复述', role: 'system',
            enabled: true, content: '用户写的内容已经发生，直接接戏，禁止重述。' }]);
        expect(direct.inferred.retelling).toBe('nmj-v62-retelling-direct');
        const irrelevant = detectTavernNativeControls([{ id: 'npc', name: '情报传递', role: 'system',
            enabled: true, content: '角色可以把秘密转述给其他 NPC，但不得让旁观者自动知情。' }]);
        expect(irrelevant.inferred.retelling).toBeUndefined();
    });

    it('Janus 的 800-1,200-word 不当作汉字长度；zh-CN 自动识别', () => {
        const classified = detectTavernNativeControls([
            { id: 'janus-length', enabled: true, role: 'system', name: '✍️字数设置',
                content: 'After </thinking>, output <content>, then write a 800-1,200-word pure plot story in zh-CN, and close </content>.' },
        ]);
        expect(classified.labels.length).toBe('800–1200 words（英文计数）');
        expect(classified.inferred.length).toBeUndefined();
        expect(classified.inferred.language).toBe('nmj-v3-language-cn');
    });

    it('篇幅 1421–2023 与 1500字正确识别，禁用作者选项不影响识别结果', () => {
        const asPrompt = (name: string, content: string, enabled = true) => ({
            id: name, name, content, role: 'system' as const, enabled,
        });
        const medium = detectTavernNativeControls([
            asPrompt('正文篇幅', '<rule>正文字数必须在1421到2023字之间。</rule>'),
            asPrompt('长篇幅（关闭）', '正文字数必须在3000到4000字之间。', false),
        ]);
        expect(medium.inferred.length).toBe('nmj-v3-length-medium');
        expect(medium.labels.length).toBe('1421–2023字');
        const exact = detectTavernNativeControls([
            asPrompt('中文字数前置', '<content>正文要求用简体中文。字数要求：1500字。</content>'),
        ]);
        expect(exact.inferred.length).toBe('nmj-v3-length-medium');
        expect(exact.inferred.language).toBe('nmj-v3-language-cn');
    });

    it('导入后能直接使用；只有显式改动才添加内置规则，保存重进不丢失且不覆盖原文', () => {
        const raw = JSON.stringify({
            prompts: [
                { identifier: 'pov', role: 'system', name: '第三人称上帝视角', content: '<POV>正文使用第三人称。</POV>' },
                { identifier: 'writer', role: 'user', name: '写作约束', content: '忠于作者专有故事设定。' },
            ],
            prompt_order: [{ character_id: 100001, order: [
                { identifier: 'pov', enabled: true }, { identifier: 'writer', enabled: true },
            ] }],
        });
        const imported = parseStoryTheaterPreset(raw, '多类作者预设.json');
        expect(imported.document.tavernControls?.inferred.pov).toBe('nmj-v3-pov-third');
        expect(buildStoryIdentityGuard(imported.document, '小雨', ['小蓝'])).toContain('第三人称');
        expect(buildStoryIdentityGuard(imported.document, '小雨', ['小蓝'])).toContain('<content> 的旁白');
        expect(buildTavernNativeOverrideMessages(imported.document, '小雨', ['小蓝'])).toEqual([]);
        const edited = { ...imported.document, tavernControls: {
            ...imported.document.tavernControls!, overrides: {
                pov: 'nmj-v3-pov-second', agency: 'nmj-v63-user-agency-locked',
                language: 'nmj-v3-language-tw', length: 'nmj-v3-length-short',
                theater: '',
            },
        } };
        const reopened = parseStoryTheaterPreset(JSON.stringify(edited), '保存重进.json');
        expect(reopened.document.tavernControls?.overrides).toEqual(edited.tavernControls.overrides);
        expect(reopened.document.prompts.map(p => p.content)).toEqual(imported.document.prompts.map(p => p.content));
        const extra = buildTavernNativeOverrideMessages(reopened.document, '小雨', ['小蓝']);
        expect(extra).toHaveLength(5);
        expect(extra.map(p => p.content).join('\n')).toContain('不生成小剧场');
        expect(extra.map(p => p.content).join('\n')).toContain('模型不创造');
        expect(buildStoryIdentityGuard(reopened.document, '小雨', ['小蓝'])).toContain('第二人称');
        const computed = compileStoryPreset({ preset: reopened,
            slots: { actors: '角色', persona: '小雨', scenario: '剧情', worldBefore: '', worldAfter: '' },
            userName: '小雨', characterNames: ['小蓝'] });
        expect(computed.nativeOverrideMessages).toEqual(extra);
        expect(computed.messages.some(p => p.role === 'user' && p.content === '忠于作者专有故事设定。')).toBe(true);
    });

    it('恶意或错误分类的内置控制 ID 不会注入其他规则，原生预设不受该字段影响', () => {
        const doc = parseStoryTheaterPreset(JSON.stringify({
            prompts: [{ identifier: 'author', role: 'system', content: '原始角色规则' }],
            prompt_order: [{ character_id: 100001, order: [{ identifier: 'author', enabled: true }] }],
        }), '类别安全.json');
        doc.document.tavernControls!.overrides = {
            pov: 'nmj-v3-theater-random',
            style: 'nmj-v3-pov-third',
            theater: '',
        };
        const reopened = parseStoryTheaterPreset(JSON.stringify(doc.document), '安全读回.json');
        expect(reopened.document.tavernControls?.overrides).toEqual({ theater: '' });
        expect(buildTavernNativeOverrideMessages(reopened.document, 'user', ['char'])).toHaveLength(1);
    });


});
