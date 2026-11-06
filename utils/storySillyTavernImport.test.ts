import { describe, expect, it } from 'vitest';
import {
    compileStoryPreset,
    parseStoryTheaterPreset,
} from './storyTheater';
import { convertSillyTavernChatPreset, expandSillyTavernPromptText } from './storySillyTavernImport';

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

    it('拒绝其它 completion JSON 与空排序伪装', () => {
        expect(() => parseStoryTheaterPreset(JSON.stringify({ prompts: [], prompt_order: [] }), 'empty.json')).toThrow();
        expect(() => parseStoryTheaterPreset(JSON.stringify({ model: 'x', messages: [] }), 'arbitrary.json')).toThrow();
        expect(() => convertSillyTavernChatPreset({ prompts: [], prompt_order: [] }, 'empty')).toThrow();
    });
});
