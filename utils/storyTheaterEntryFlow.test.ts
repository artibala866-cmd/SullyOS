// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoryTheaterEntry } from '../types';
import StoryTheaterEditor from '../components/date/story/StoryTheaterEditor';
import { createStoryTheaterDraft, BUILTIN_NIGHT_SCREENING_PRESET } from './storyTheater';
import { DB } from './db';

vi.mock('../components/os/TokenImg', () => ({ default: () => null }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null, host: HTMLElement | null = null;
const actor = { id: 'entry-flow-char', name: '角色甲', avatar: '', mountedWorldbooks: [], systemPrompt: '一个角色', memories: [] } as any;
afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    host?.remove();
    root = null; host = null;
});
async function render(initial: StoryTheaterEntry, characters = [actor], save: (entry: StoryTheaterEntry) => Promise<void> = async () => {}) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(React.createElement(StoryTheaterEditor, {
        initial, characters, user: { name: '用户' } as any, masks: [], maskLocked: false,
        presets: [BUILTIN_NIGHT_SCREENING_PRESET], onCancel: () => {}, onSave: save,
        onImportPreset: async () => null, onEditPreset: () => {}, onOpenMaskBox: () => {},
    })));
}
async function clickButton(text: string) {
    const button = [...host!.querySelectorAll('button')].find(button => button.textContent?.trim() === text);
    expect(button, text).toBeTruthy();
    await act(async () => button!.click());
}
describe('见面剧情编辑器真实点击及错误恢复', () => {
    it('空标题不会静默禁用按钮；点击明确提示和聚焦标题', async () => {
        const save = vi.fn(async () => {});
        await render({ ...createStoryTheaterDraft(), characterIds: [actor.id] }, [actor], save);
        const button = [...host!.querySelectorAll('button')].find(b => b.textContent?.trim() === '保存并进入');
        expect(button?.disabled).toBe(false);
        await clickButton('保存并进入');
        expect(host!.querySelector('[role=alert]')?.textContent).toContain('剧情标题');
        expect(document.activeElement).toBe(host!.querySelector('input[placeholder="剧情名称"]'));
        expect(save).not.toHaveBeenCalled();
    });
    it('标题有效但未选演员时说明如何进入，不需要猜其他开关', async () => {
        const save = vi.fn(async () => {});
        await render({ ...createStoryTheaterDraft(), title: '雨夜重逢' }, [actor], save);
        await clickButton('保存并进入');
        expect(host!.querySelector('[role=alert]')?.textContent).toContain('让谁参与');
        expect(host!.querySelector('[role=alert]')?.textContent).toContain('其他开关');
        expect(save).not.toHaveBeenCalled();
        await clickButton('角色甲');
        await clickButton('保存并进入');
        expect(save).toHaveBeenCalledTimes(1);
        expect(save.mock.calls[0][0]).toMatchObject({ title: '雨夜重逢', characterIds: [actor.id] });
    });
    it('写入失败仍保留编辑内容，用户可以重新保存并查到持久化数据', async () => {
        let fail = true;
        const save = vi.fn(async (story: StoryTheaterEntry) => {
            if (fail) throw new Error('本地存储临时不可用');
            await DB.saveStoryTheater(story);
        });
        await render({ ...createStoryTheaterDraft(), title: '我保存的剧情', characterIds: [actor.id] }, [actor], save);
        await clickButton('保存并进入');
        expect(host!.querySelector('[role=alert]')?.textContent).toContain('本地存储临时不可用');
        expect((host!.querySelector('input[placeholder="剧情名称"]') as HTMLInputElement).value).toBe('我保存的剧情');
        fail = false;
        await clickButton('保存并进入');
        expect(save).toHaveBeenCalledTimes(2);
        expect((await DB.getStoryTheaters()).find(story => story.title === '我保存的剧情')?.characterIds).toEqual([actor.id]);
    });
    it('没有任何角色时，不丢草稿，明确告知必须先建立角色', async () => {
        await render({ ...createStoryTheaterDraft(), title: '无角色' }, []);
        await clickButton('保存并进入');
        expect(host!.querySelector('[role=alert]')?.textContent).toContain('先在角色应用中建立角色');
    });
});
