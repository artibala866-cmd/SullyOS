// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StoryQuickPresetPanel from '../components/date/story/StoryQuickPresetPanel';
import { DB } from './db';
import {
    BUILTIN_NIGHT_SCREENING_PRESET, compileStoryPreset, createStoryTheaterDraft,
    getStoryTavernAuthorSections, parseStoryTheaterPreset,
    resolveStoryPresetDocument,
} from './storyTheater';
import type { StoryTheaterEntry, StoryTheaterPresetDocument } from '../types';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    host?.remove(); root = null; host = null;
});

const authorPreset = () => parseStoryTheaterPreset(JSON.stringify({
    prompts: [
        { identifier: 'core', role: 'system', name: '底座不要关', content: 'AUTHOR-CORE-ALWAYS' },
        { identifier: 'styleWarm', role: 'system', name: '文风：温柔', content: '{{setvar::专属文风::温柔雨夜}}' },
        { identifier: 'styleCold', role: 'system', name: '文风：冷冽', content: '{{setvar::专属文风::冷冽悬疑}}' },
        { identifier: 'consume', role: 'system', name: '使用选中文风', content: '实际文风={{getvar::专属文风}}' },
        { identifier: 'agencyLow', role: 'system', name: '不抢话', content: 'AUTHOR-AGENCY-LOW' },
        { identifier: 'agencyHigh', role: 'system', name: '完全演绎', content: 'AUTHOR-AGENCY-HIGH' },
    ],
    prompt_order: [{ character_id: 100001, order: [
        { identifier: 'core', enabled: true },
        { identifier: 'styleWarm', enabled: true },
        { identifier: 'styleCold', enabled: false },
        { identifier: 'consume', enabled: true },
        { identifier: 'agencyLow', enabled: true },
        { identifier: 'agencyHigh', enabled: false },
    ] }],
    extensions: { entryGrouping: [
        { id: 'authorStyle', name: '文风·月光色盘（择一）', memberIdentifiers: ['styleWarm','styleCold'] },
        { id: 'authorAgency', name: '作者执笔权（择一）', memberIdentifiers: ['agencyLow','agencyHigh'] },
    ] },
}), '从未见过的作者.json', 30);

const compileText = (document: StoryTheaterPresetDocument) => {
    const preset = { ...authorPreset(), document };
    return compileStoryPreset({
        preset, slots: { actors: '角色设定', persona: '玩家', scenario: '今晚', worldBefore: '', worldAfter: '', history: '' },
        userName: '玩家', characterNames: ['角色'],
    }).messages.map(m => m.content).join('\n');
};

const mount = async (document: StoryTheaterPresetDocument,
    onApply: (doc: StoryTheaterPresetDocument) => Promise<void> | void,
    onReset = async () => {}, onClose = vi.fn(), hasOverride = false) => {
    host = globalThis.document.createElement('div'); globalThis.document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(React.createElement(StoryQuickPresetPanel, {
        document, hasOverride, onApply, onReset, onClose,
    })));
    return host;
};
const press = async (element: HTMLElement | null | undefined) => {
    expect(element).toBeDefined();
    await act(async () => element!.click());
};
const buttonNamed = (text: string) => [...(host?.querySelectorAll('button') || [])]
    .find(button => button.textContent?.trim() === text);

describe('真实剧情内快捷预设 —— 酒馆原作者条目跨入口运行', () => {
    it('陌生酒馆作者的文风无需内置 ID；即时切换影响请求，应用仅覆盖当前剧情并写入 DB', async () => {
        const preset = authorPreset();
        expect(getStoryTavernAuthorSections(preset.document).map(g => g.label))
            .toEqual(expect.arrayContaining(['文风·月光色盘（择一）', '作者执笔权（择一）']));
        expect(compileText(preset.document)).toContain('实际文风=温柔雨夜');
        const entry: StoryTheaterEntry = { ...createStoryTheaterDraft(), id: 'quick-tavern-live-unknown',
            title: '快速预设独立故事', presetId: preset.id };
        await DB.saveStoryTheaterPreset(preset);
        await DB.saveStoryTheater(entry);
        const onApply = vi.fn(async (document: StoryTheaterPresetDocument) => {
            await DB.saveStoryTheater({ ...entry, presetOverride: document, updatedAt: 400 });
        });
        const sheet = await mount(preset.document, onApply);
        expect(sheet.textContent).toContain('文风·月光色盘');
        expect(sheet.textContent).toContain('冷冽');
        expect(sheet.textContent).not.toContain('没有可用于默认版的选项');
        const cold = [...sheet.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')]
            .find(b => b.textContent?.includes('文风：冷冽'));
        expect(cold?.getAttribute('aria-pressed')).toBe('false');
        await press(cold);
        const warm = [...sheet.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')]
            .find(b => b.textContent?.includes('文风：温柔'));
        expect(warm?.getAttribute('aria-pressed')).toBe('false');
        expect(sheet.textContent).toContain('当前：文风：冷冽');
        await press(buttonNamed('应用到本剧情'));
        expect(onApply).toHaveBeenCalledOnce();
        const saved = (await DB.getStoryTheaters()).find(e => e.id === entry.id)!;
        expect(saved.presetOverride?.prompts.find(p => p.id === 'st-styleCold')?.enabled).toBe(true);
        expect(saved.presetOverride?.prompts.find(p => p.id === 'st-styleWarm')?.enabled).toBe(false);
        expect(saved.presetOverride?.prompts.find(p => p.id === 'st-core')?.enabled).toBe(true);
        expect(saved.presetOverride?.prompts.find(p => p.id === 'st-agencyLow')?.enabled).toBe(true);
        const source = (await DB.getStoryTheaterPresets()).find(p => p.id === preset.id)!;
        expect(source.document.prompts.find(p => p.id === 'st-styleWarm')?.enabled).toBe(true);
        const effective = resolveStoryPresetDocument(source, saved.presetOverride);
        expect(compileText(effective)).toContain('实际文风=冷冽悬疑');
        expect(compileText(effective)).not.toContain('实际文风=温柔雨夜');
        expect(compileText(effective)).toContain('AUTHOR-CORE-ALWAYS');
        await DB.deleteStoryTheater(entry.id);
        await DB.deleteStoryTheaterPreset(preset.id);
    });

    it('故事内支持按原作者分组切换权限，不污染原 preset；恢复按钮会清除局部覆盖', async () => {
        const preset = authorPreset();
        const entry: StoryTheaterEntry = { ...createStoryTheaterDraft(), id: 'quick-tavern-reset',
            title: '独立故事重置', presetId: preset.id };
        await DB.saveStoryTheater(entry);
        const onApply = vi.fn(async (document: StoryTheaterPresetDocument) =>
            DB.saveStoryTheater({ ...entry, presetOverride: document }));
        const sheet = await mount(preset.document, onApply);
        await press([...sheet.querySelectorAll<HTMLButtonElement>('nav button')].find(b => b.textContent?.includes('作者执笔权')));
        expect(sheet.textContent).toContain('不抢话');
        await press([...sheet.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')]
            .find(b => b.textContent?.includes('完全演绎')));
        await press(buttonNamed('应用到本剧情'));
        const modified = (await DB.getStoryTheaters()).find(e => e.id === entry.id)!;
        expect(compileText(modified.presetOverride!)).toContain('AUTHOR-AGENCY-HIGH');
        expect(compileText(modified.presetOverride!)).not.toContain('AUTHOR-AGENCY-LOW');
        await act(async () => root!.unmount()); root = null; host!.remove(); host = null;
        const reset = vi.fn(async () => DB.saveStoryTheater({ ...entry, presetOverride: undefined }));
        const reopened = await mount(resolveStoryPresetDocument(preset, modified.presetOverride), vi.fn(), reset, vi.fn(), true);
        expect(reopened.textContent).toContain('恢复原预设');
        await press(buttonNamed('恢复原预设'));
        expect(reset).toHaveBeenCalledOnce();
        const restored = (await DB.getStoryTheaters()).find(e => e.id === entry.id)!;
        expect(restored.presetOverride).toBeUndefined();
        expect(compileText(resolveStoryPresetDocument(preset, restored.presetOverride))).toContain('AUTHOR-AGENCY-LOW');
        await DB.deleteStoryTheater(entry.id);
    });

    it('内置预设仍使用原内置快捷选项，陌生作者才使用源分组', async () => {
        const sheet = await mount(BUILTIN_NIGHT_SCREENING_PRESET.document, vi.fn());
        expect(sheet.textContent).toContain('文风');
        expect(sheet.textContent).not.toContain('文风·月光色盘');
        expect(sheet.querySelectorAll('button[aria-pressed]')).toHaveLength(0);
    });
});
