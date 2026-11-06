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
async function render(
    initial: StoryTheaterEntry, characters = [actor],
    save: (entry: StoryTheaterEntry) => Promise<void> = async () => {},
    onChangeGreeting?: (characterId: string, greetingId: string, content: string | null) => Promise<void>,
    maskLocked = false,
) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(React.createElement(StoryTheaterEditor, {
        initial, characters, user: { name: '用户' } as any, masks: [], maskLocked,
        presets: [BUILTIN_NIGHT_SCREENING_PRESET], onCancel: () => {}, onSave: save,
        onImportPreset: async () => null, onEditPreset: () => {}, onOpenMaskBox: () => {},
        onChangeGreeting,
    })));
}
async function clickButton(text: string) {
    const button = [...host!.querySelectorAll('button')].find(button => button.textContent?.trim() === text);
    expect(button, text).toBeTruthy();
    await act(async () => button!.click());
}
describe('见面剧情编辑器真实点击及错误恢复', () => {
    it('空标题不会静默禁用按钮；点击明确提示和聚焦标题', async () => {
        const save = vi.fn(async (_entry: StoryTheaterEntry) => {});
        await render({ ...createStoryTheaterDraft(), characterIds: [actor.id] }, [actor], save);
        const button = [...host!.querySelectorAll('button')].find(b => b.textContent?.trim() === '保存并进入');
        expect(button?.disabled).toBe(false);
        await clickButton('保存并进入');
        expect(host!.querySelector('[role=alert]')?.textContent).toContain('剧情标题');
        expect(document.activeElement).toBe(host!.querySelector('input[placeholder="剧情名称"]'));
        expect(save).not.toHaveBeenCalled();
    });
    it('标题有效但未选演员时说明如何进入，不需要猜其他开关', async () => {
        const save = vi.fn(async (_entry: StoryTheaterEntry) => {});
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
    it('选择再取消酒馆开场白，不会暗中切换“我先写”的开场方式', async () => {
        const greetingActor = { ...actor, tavernGreetings: [
            { id: 'tavern-first', title: '默认开场白', content: '{{char}}已经开场' },
        ] };
        const save = vi.fn(async (_entry: StoryTheaterEntry) => {});
        await render({ ...createStoryTheaterDraft(), title: '开场选择', characterIds: [actor.id] }, [greetingActor], save);
        const select = host!.querySelector('select[aria-label="选择酒馆卡开场白"]') as HTMLSelectElement;
        expect(select).toBeTruthy();
        await act(async () => {
            select.value = `${actor.id}::tavern-first`;
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await act(async () => {
            select.value = '';
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await clickButton('保存并进入');
        expect(save).toHaveBeenCalledTimes(1);
        expect(save.mock.calls[0][0]).toMatchObject({ openingMode: 'user' });
        expect(save.mock.calls[0][0].openingGreeting).toBeUndefined();
    });
    it('开场白原文已删除且没有其它候选时能清理残留关联', async () => {
        const save = vi.fn(async (_entry: StoryTheaterEntry) => {});
        await render({ ...createStoryTheaterDraft(), title: '丢失的开场', characterIds: [actor.id],
            openingGreeting: { characterId: actor.id, greetingId: 'missing' } }, [actor], save);
        expect(host!.textContent).toContain('原开场白已失效');
        await clickButton('清除失效选择');
        await clickButton('保存并进入');
        expect(save.mock.calls[0][0].openingGreeting).toBeUndefined();
    });
    it('删除原卡素材不会清掉已有剧情的历史开场白关联', async () => {
        const greetingActor = { ...actor, tavernGreetings: [
            { id: 'tavern-first', title: '默认开场白', content: '下雨了' },
        ] };
        const edit = vi.fn(async () => {});
        const save = vi.fn(async (_entry: StoryTheaterEntry) => {});
        await render({ ...createStoryTheaterDraft(), title: '旧剧情', characterIds: [actor.id],
            openingGreeting: { characterId: actor.id, greetingId: 'tavern-first' },
        }, [greetingActor], save, edit, true);
        await clickButton('删除');
        await clickButton('确认删除');
        expect(edit).toHaveBeenCalledWith(actor.id, 'tavern-first', null);
        await clickButton('保存并进入');
        expect(save.mock.calls[0][0].openingGreeting).toEqual({
            characterId: actor.id, greetingId: 'tavern-first',
        });
    });
    it('连续双击保存只执行一次异步写入', async () => {
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const save = vi.fn(async (_entry: StoryTheaterEntry) => { await gate; });
        await render({ ...createStoryTheaterDraft(), title: '防止连点', characterIds: [actor.id] }, [actor], save);
        const button = [...host!.querySelectorAll('button')].find(b => b.textContent?.trim() === '保存并进入')!;
        await act(async () => { button.click(); button.click(); });
        expect(save).toHaveBeenCalledTimes(1);
        await act(async () => { release(); await gate; });
    });
    it('没有任何角色时，不丢草稿，明确告知必须先建立角色', async () => {
        await render({ ...createStoryTheaterDraft(), title: '无角色' }, []);
        await clickButton('保存并进入');
        expect(host!.querySelector('[role=alert]')?.textContent).toContain('先在角色应用中建立角色');
    });
});
