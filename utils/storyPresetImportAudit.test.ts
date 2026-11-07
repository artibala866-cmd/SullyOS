import { describe, expect, it } from 'vitest';
import { DB } from './db';
import { compileStoryPreset, parseStoryTheaterPreset, resolveStoryPresetImport } from './storyTheater';

const mk = (content = '原始规则', more: Record<string, unknown> = {}) => JSON.stringify({
    prompts: [
        { identifier: 'rule', name: '作者规则', role: 'system', content },
        { identifier: 'chatHistory', role: 'system', marker: true },
    ],
    prompt_order: [{ character_id: 100001, order: [
        { identifier: 'rule', enabled: true },
        { identifier: 'chatHistory', enabled: true },
    ] }],
    ...more,
});
const slots = { actors: '角色', persona: '身份', scenario: '剧情', worldBefore: '', worldAfter: '', history: '' };
const parse = (s: string, name = '用户预设.json') => parseStoryTheaterPreset(s, name, 17);

describe('剧情预设导入全链路与真实文件异常审计', () => {
    it('重复导入文件、保存后退出重进都复用同一数据 ID，而不是创建同名副本', async () => {
        const first = parse(mk(), '审计专用.json');
        await DB.saveStoryTheaterPreset(first);
        const reloaded = (await DB.getStoryTheaterPresets()).filter(p => p.sourceFileName === '审计专用.json');
        expect(reloaded.some(p => p.id === first.id)).toBe(true);
        const repeated = parse(mk(), '审计专用.json');
        const resolved = resolveStoryPresetImport(repeated, reloaded);
        expect(resolved.duplicate).toBe(true);
        expect(resolved.preset.id).toBe(first.id);
        expect(resolved.preset.createdAt).toBe(first.createdAt);
        await DB.deleteStoryTheaterPreset(first.id);
    });

    it('升级新增的正则和 HTML 小剧场兼容提示不能导致旧预设重复导入或覆盖编辑记录', () => {
        const source = mk('<sidestory>HTML 小剧场仅作原文</sidestory>', {
            extensions: { regex_scripts: [{
                scriptName: '旧酒馆美化', disabled: false,
                placement: [2], findRegex: '<sidestory>', replaceString: '<div>',
            }] },
        });
        const imported = parse(source, '旧存档里的酒馆预设.json');
        expect(imported.document.importWarnings?.join('')).toContain('正则');
        expect(imported.document.importWarnings?.join('')).toContain('小剧场');
        const legacyStored = { ...imported, document: {
            ...imported.document, importWarnings: ['旧版导入时的提醒，不包含新版 HTML 检测'],
        } };
        const resolved = resolveStoryPresetImport(imported, [legacyStored]);
        expect(resolved.duplicate).toBe(true);
        expect(resolved.preset.id).toBe(legacyStored.id);
        const changed = { ...legacyStored, document: {
            ...legacyStored.document,
            prompts: legacyStored.document.prompts.map(prompt => prompt.id === 'st-rule'
                ? { ...prompt, content: '用户自己修改的剧情指令' } : prompt),
        } };
        const distinct = resolveStoryPresetImport(imported, [changed]);
        expect(distinct.duplicate).toBe(false);
        expect(distinct.preset.id).not.toBe(changed.id);
        expect(changed.document.prompts[0].content).toBe('用户自己修改的剧情指令');
    });

    it('用户编辑过同名预设后再次导入：旧数据不动，新版本分配独立 ID 和可区分的名称', () => {
        const before = parse(mk(), '同名冲突.json');
        const changed = { ...before, document: { ...before.document,
            prompts: before.document.prompts.map(p => p.id === 'st-rule'
                ? { ...p, content: '用户手动编辑的重要文字' } : p) } };
        const result = resolveStoryPresetImport(parse(mk(), '同名冲突.json'), [changed]);
        expect(result.duplicate).toBe(false);
        expect(result.preset.id).not.toBe(changed.id);
        expect(result.preset.name).toBe('同名冲突（导入 2）');
        expect(changed.document.prompts[0].content).toBe('用户手动编辑的重要文字');
        const repeat = resolveStoryPresetImport(parse(mk(), '同名冲突.json'), [changed, result.preset]);
        expect(repeat.duplicate).toBe(true);
        expect(repeat.preset.id).toBe(result.preset.id);
        const third = resolveStoryPresetImport(parse(mk('新版变化'), '同名冲突.json'), [changed, result.preset]);
        expect(third.preset.name).toBe('同名冲突（导入 3）');
    });

    it('UTF-8 BOM、新老排序表、省略 enabled 和 developer 角色均不会吞正文', () => {
        const src = '\uFEFF' + JSON.stringify({
            prompts: [{ identifier: 'rule', role: 'developer', content: '说明不能丢' },
                { identifier: 'chatHistory', marker: true, content: '' }],
            prompt_order: [{ character_id: 100001,
                order: [{ identifier: 'rule' }, { identifier: 'chatHistory' }] }],
        });
        const doc = parse(src).document;
        expect(doc.prompts.map(p => p.enabled)).toEqual([true, true]);
        expect(doc.prompts[0]).toMatchObject({ role: 'system', content: '说明不能丢' });
        const output = compileStoryPreset({ preset: { ...parse(src), document: doc }, slots, userName: 'user',
            characterNames: ['char'], historyMessages: [{ role: 'user', content: '我的话' }] });
        expect(output.messages.map(m => m.content)).toContain('说明不能丢');
        expect(output.messages.map(m => m.content)).toContain('我的话');
    });

    it('启用的标准 marker 附带作者正文时，既发送动态槽位也发送原有文字', () => {
        const src = JSON.stringify({
            prompts: [{ identifier: 'scenario', marker: true, role: 'system',
                content: '<notes>作者附加的真实内容</notes>' }],
            prompt_order: [{ character_id: 100001, order: [{ identifier: 'scenario', enabled: true }] }],
        });
        const doc = parse(src);
        expect(doc.document.prompts.map(p => p.id)).toEqual(['st-scenario', 'st-scenario-content']);
        const sent = compileStoryPreset({ preset: doc, slots, userName: 'user',
            characterNames: ['char'] }).messages.map(m => m.content);
        expect(sent).toEqual(['剧情', '<notes>作者附加的真实内容</notes>']);
    });

    it('重复标识、重复排序、缺失启用提示、未知角色明确中止，原有对象没有发生改变', () => {
        const src = (prompts: unknown[], order: unknown[]) => JSON.stringify({
            prompts, prompt_order: [{ character_id: 100001, order }],
        });
        const normal = { identifier: 'same', content: '原文', role: 'system' };
        const saved = parse(mk());
        const previous = JSON.stringify(saved);
        expect(() => parse(src([normal, { ...normal, content: '不同原文' }],
            [{ identifier: 'same', enabled: true }]))).toThrow('重复');
        expect(() => parse(src([normal, { identifier: '', content: '遗失ID的原文' }],
            [{ identifier: 'same', enabled: true }]))).toThrow('identifier');
        expect(() => parse(src([normal],
            [{ identifier: 'missing', enabled: true }]))).toThrow('缺少');
        expect(() => parse(src([normal],
            [{ identifier: 'same', enabled: true }, { identifier: 'same', enabled: false }]))).toThrow('重复');
        expect(() => parse(src([{ identifier: 'tool', role: 'tool', content: '工具响应' }],
            [{ identifier: 'tool', enabled: true }]))).toThrow('角色');
        expect(JSON.stringify(saved)).toBe(previous);
    });

    it('坏 JSON、空文件、错误模板、超大文件和原生数据不会误判或崩溃', () => {
        expect(() => parse('{ bad')).toThrow('JSON');
        expect(() => parse('')).toThrow('JSON');
        expect(() => parse('null')).toThrow();
        expect(() => parse('{}')).toThrow('只接受');
        expect(() => parse('X'.repeat(5 * 1024 * 1024 + 1))).toThrow('5 MB');
        expect(() => parse(JSON.stringify({ story_string: '{{char}}' }))).toThrow('文本补全模板');
        const native = { schema: 'sullyos.story-preset', version: 1, name: '旧版原生', prompts: [{
            id: 'one', name: '原生规则', enabled: true, role: 'system', content: '<content>保留</content>',
        }] };
        const restored = parse(JSON.stringify(native), '旧原生.json');
        expect(restored.document.sourceFormat).toBeUndefined();
        expect(restored.document.prompts[0].content).toBe('<content>保留</content>');
        expect(resolveStoryPresetImport(restored, [undefined as any]).duplicate).toBe(false);
    });

    it('多文件依次导入含失败时：已成功的文件可保留、错误数据无法进入持久化', async () => {
        const success = parse(mk('第一份规则'), '首个有效文件.json');
        await DB.saveStoryTheaterPreset(success);
        const broken = JSON.stringify({ prompts: [
            { identifier: 'a', role: 'system', content: 'A' },
            { identifier: 'a', role: 'system', content: 'B' },
        ], prompt_order: [{ character_id: 100001, order: [{ identifier: 'a', enabled: true }] }] });
        expect(() => parse(broken, '有冲突的文件.json')).toThrow('重复');
        const next = parse(mk('第二份规则'), '第二个有效文件.json');
        await DB.saveStoryTheaterPreset(next);
        const saved = await DB.getStoryTheaterPresets();
        expect(saved.find(p => p.id === success.id)?.document.prompts[0].content).toBe('第一份规则');
        expect(saved.find(p => p.id === next.id)?.document.prompts[0].content).toBe('第二份规则');
        expect(saved.some(p => p.sourceFileName === '有冲突的文件.json')).toBe(false);
        await DB.deleteStoryTheaterPreset(success.id);
        await DB.deleteStoryTheaterPreset(next.id);
    });
});
