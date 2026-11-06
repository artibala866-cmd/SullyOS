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
    it('故事先写可选已有开场，取消后保留原自动开场', async () => {
        const greetingActor = { ...actor, tavernGreetings: [
            { id: 'tavern-first', title: '默认开场白', content: '{{char}}已经开场' },
        ] };
        const save = vi.fn(async (_entry: StoryTheaterEntry) => {});
        await render({ ...createStoryTheaterDraft(), title: '开场选择', characterIds: [actor.id] }, [greetingActor], save);
        expect(host!.querySelector('select[aria-label="选择已有开场"]')).toBeNull();
        await clickButton('故事先写');
        const select = host!.querySelector('select[aria-label="选择已有开场"]') as HTMLSelectElement;
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
        expect(save.mock.calls[0][0]).toMatchObject({ openingMode: 'assistant' });
        expect(save.mock.calls[0][0].openingGreeting).toBeUndefined();
    });
    it('我先写继续使用原有手动开场，切换后清理已选素材', async () => {
        const greetingActor = { ...actor, tavernGreetings: [
            { id: 'tavern-first', title: '默认开场白', content: '雨停了' },
        ] };
        const save = vi.fn(async (_entry: StoryTheaterEntry) => {});
        await render({ ...createStoryTheaterDraft(), title: '我来开场', characterIds: [actor.id],
            openingMode: 'assistant', openingGreeting: { characterId: actor.id, greetingId: 'tavern-first' },
        }, [greetingActor], save);
        await clickButton('我先写');
        expect(host!.querySelector('select[aria-label="选择已有开场"]')).toBeNull();
        await clickButton('保存并进入');
        expect(save.mock.calls[0][0]).toMatchObject({ openingMode: 'user' });
        expect(save.mock.calls[0][0].openingGreeting).toBeUndefined();
    });
    it('整个编辑器只有原故事设置中的一个开场选择，角色区没有重复模块', async () => {
        const greetingActor = { ...actor, tavernGreetings: [
            { id: 'tavern-first', title: '默认开场白', content: '清晨' },
        ] };
        await render({ ...createStoryTheaterDraft(), title: '唯一开场', characterIds: [actor.id],
            openingMode: 'assistant',
        }, [greetingActor]);
        const settings = host!.querySelector('[data-story-opening-settings="true"]');
        expect(settings?.querySelectorAll('select[aria-label="选择已有开场"]')).toHaveLength(1);
        const cast = [...host!.querySelectorAll('section')].find(section => section.textContent?.includes('让谁参与'));
        expect(cast?.querySelector('select[aria-label="选择已有开场"]')).toBeNull();
        expect(host!.textContent).not.toContain('酒馆卡');
        expect(host!.textContent).not.toContain('Tavern opening');
    });
    it('开场白原文已删除且没有其它候选时能清理残留关联', async () => {
        const save = vi.fn(async (_entry: StoryTheaterEntry) => {});
        await render({ ...createStoryTheaterDraft(), title: '丢失的开场', characterIds: [actor.id],
            openingGreeting: { characterId: actor.id, greetingId: 'missing' } }, [actor], save);
        expect(host!.textContent).toContain('原开场已失效');
        await clickButton('清除失效选择');
        await clickButton('保存并进入');
        expect(save.mock.calls[0][0].openingGreeting).toBeUndefined();
    });
    it('未保存的开场白修改不会被“保存并进入”静默丢弃', async () => {
        const greetingActor = { ...actor, tavernGreetings: [
            { id: 'tavern-first', title: '默认开场白', content: '旧内容' },
        ] };
        const save = vi.fn(async (_entry: StoryTheaterEntry) => {});
        await render({ ...createStoryTheaterDraft(), title: '改写首幕', characterIds: [actor.id],
            openingGreeting: { characterId: actor.id, greetingId: 'tavern-first' },
        }, [greetingActor], save, async () => {});
        await clickButton('修改');
        await clickButton('保存并进入');
        expect(save).not.toHaveBeenCalled();
        expect(host!.querySelector('[role=alert]')?.textContent).toContain('请先保存或取消');
        await clickButton('取消');
        await clickButton('保存并进入');
        expect(save).toHaveBeenCalledTimes(1);
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
    it('剧情已开场后不再允许增删参与角色，避免破坏开场关联与历史', async () => {
        const actorB = { ...actor, id: 'entry-flow-b', name: '角色乙' };
        const save = vi.fn(async (_entry: StoryTheaterEntry) => {});
        await render({
            ...createStoryTheaterDraft(), title: '已开场剧情', characterIds: [actor.id],
            openingMode: 'assistant', openingGreeting: { characterId: actor.id, greetingId: 'first' },
            openingGreetingInitialized: true,
        }, [actor, actorB], save, undefined, true);
        const buttons = [...host!.querySelectorAll('button')];
        const first = buttons.find(button => button.textContent?.trim() === '角色甲');
        const second = buttons.find(button => button.textContent?.trim() === '角色乙');
        expect(first?.disabled).toBe(true);
        expect(second?.disabled).toBe(true);
        await act(async () => { first!.click(); second!.click(); });
        await clickButton('保存并进入');
        expect(save.mock.calls[0][0].characterIds).toEqual([actor.id]);
        expect(save.mock.calls[0][0].openingGreeting).toEqual({
            characterId: actor.id, greetingId: 'first',
        });
    });
    it('编辑器里移除提供开场白的角色时，清理悬空引用且不重复开场', async () => {
        const greetingActor = { ...actor, tavernGreetings: [
            { id: 'first', title: '开场一', content: '晚风吹过' },
        ] };
        const actorB = { ...actor, id: 'entry-flow-b2', name: '角色乙' };
        const save = vi.fn(async (_entry: StoryTheaterEntry) => {});
        await render({
            ...createStoryTheaterDraft(), title: '移除开场角色',
            characterIds: [actor.id, actorB.id], openingMode: 'assistant',
            openingGreeting: { characterId: actor.id, greetingId: 'first' },
        }, [greetingActor, actorB], save);
        await clickButton('角色甲');
        await clickButton('保存并进入');
        expect(save.mock.calls[0][0].characterIds).toEqual([actorB.id]);
        expect(save.mock.calls[0][0].openingGreeting).toBeUndefined();
        expect(save.mock.calls[0][0].openingMode).toBe('assistant');
    });
    it('没有任何角色时，不丢草稿，明确告知必须先建立角色', async () => {
        await render({ ...createStoryTheaterDraft(), title: '无角色' }, []);
        await clickButton('保存并进入');
        expect(host!.querySelector('[role=alert]')?.textContent).toContain('先在角色应用中建立角色');
    });
});
