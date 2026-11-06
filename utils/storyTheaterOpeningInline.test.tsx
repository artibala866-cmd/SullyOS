// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StoryTheaterEditor from '../components/date/story/StoryTheaterEditor';
import { BUILTIN_NIGHT_SCREENING_PRESET, createStoryTheaterDraft } from './storyTheater';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../components/os/TokenImg', () => ({ default: () => null }));

const opening = { id: 'opening-1', title: '雨夜', content: '旧的开场正文' };
const actor = {
    id: 'actor-1', name: '测试角色', avatar: '', systemPrompt: '',
    memories: [], mountedWorldbooks: [], tavernGreetings: [opening],
} as any;
let host: HTMLDivElement | null = null;
let root: Root | null = null;
afterEach(async () => {
    if (root) await act(async () => { root!.unmount(); });
    host?.remove();
    host = null;
    root = null;
});

const field = () => host!.querySelector<HTMLTextAreaElement>('main section textarea')!;
const button = (name: string) => {
    const found = [...host!.querySelectorAll('button')].find(b => b.textContent?.trim() === name);
    expect(found, `Missing button: ${name}`).toBeTruthy();
    return found!;
};
const typeInto = async (el: HTMLTextAreaElement, value: string) => {
    await act(async () => {
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
        set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    });
};
const click = async (name: string) => {
    await act(async () => { button(name).click(); });
};

describe('剧情开场白复用上方剧情介绍输入框', () => {
    it('开场白直接在原大框展示，介绍/开场分开存，修改取消保存及删除不串内容', async () => {
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        const onChangeGreeting = vi.fn(async (_characterId: string, _greetingId: string, _body: string | null) => {});
        const onSave = vi.fn();
        const initial = {
            ...createStoryTheaterDraft(), title: '雨夜故事', premise: '保留的剧情介绍',
            characterIds: [actor.id], openingMode: 'assistant' as const,
            openingGreeting: { characterId: actor.id, greetingId: opening.id },
        };
        const props = {
            initial, characters: [actor], user: { name: '用户' } as any,
            masks: [], maskLocked: false, presets: [BUILTIN_NIGHT_SCREENING_PRESET],
            onCancel: vi.fn(), onSave, onImportPreset: async () => null,
            onEditPreset: vi.fn(), onOpenMaskBox: vi.fn(), onChangeGreeting,
        };
        await act(async () => { root!.render(React.createElement(StoryTheaterEditor, props)); });

        expect(field().getAttribute('data-story-opening-editor')).toBe('true');
        expect(field().value).toBe(opening.content);
        expect(host!.querySelector('[data-story-opening-settings] textarea')).toBeNull();
        expect(host!.querySelector('[data-story-opening-settings]')!.textContent).not.toContain(opening.content);

        await click('剧情介绍');
        expect(field().value).toBe('保留的剧情介绍');
        await typeInto(field(), '重新写的介绍');
        await click('开场白');
        expect(field().value).toBe(opening.content);
        expect(onChangeGreeting).not.toHaveBeenCalled();

        await typeInto(field(), '草稿不应保存');
        expect(button('保存修改')).toBeTruthy();
        await click('取消');
        expect(field().value).toBe(opening.content);
        expect(onChangeGreeting).not.toHaveBeenCalled();

        await typeInto(field(), '真正保存的开场');
        expect((host!.querySelector('select[aria-label="选择已有开场"]') as HTMLSelectElement).disabled).toBe(true);
        await click('保存修改');
        expect(onChangeGreeting).toHaveBeenCalledWith(actor.id, opening.id, '真正保存的开场');
        expect(onSave).not.toHaveBeenCalled();

        const changedActor = { ...actor, tavernGreetings: [{ ...opening, content: '真正保存的开场' }] };
        await act(async () => { root!.render(React.createElement(StoryTheaterEditor, { ...props, characters: [changedActor] })); });
        expect(field().value).toBe('真正保存的开场');
        await click('剧情介绍');
        expect(field().value).toBe('重新写的介绍');
        await click('开场白');
        await click('删除');
        expect(host!.textContent).toContain('从角色的开场库删除？');
        await click('确认删除');
        expect(onChangeGreeting).toHaveBeenLastCalledWith(actor.id, opening.id, null);
        expect(field().getAttribute('data-story-opening-editor')).toBeNull();
        expect(field().value).toBe('重新写的介绍');
    });

    it('手写内容点书签保存后自动出现在已有开场，同一段不重复进入剧情介绍', async () => {
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        const create = vi.fn(async (_actorId: string, _title: string, content: string) => ({
            id: 'custom-1', title: '自拟开场', content,
        }));
        const onSave = vi.fn(async () => {});
        const props = {
            initial: { ...createStoryTheaterDraft(), title: '自拟剧情', characterIds: [actor.id] },
            characters: [{ ...actor, tavernGreetings: [] }], user: { name: '用户' } as any,
            masks: [], maskLocked: false, presets: [BUILTIN_NIGHT_SCREENING_PRESET],
            onCancel: vi.fn(), onSave, onImportPreset: async () => null,
            onEditPreset: vi.fn(), onOpenMaskBox: vi.fn(), onCreateGreeting: create,
        };
        await act(async () => root!.render(React.createElement(StoryTheaterEditor, props)));
        expect(host!.querySelector('select[aria-label="选择已有开场"]')!.textContent).toContain('暂无可选开场');
        await typeInto(field(), '<!-- title:起点 -->\n清晨，门外有人敲门。');
        expect((host!.querySelector('[data-story-opening-save]') as HTMLButtonElement).disabled).toBe(false);
        await act(async () => (host!.querySelector('[data-story-opening-save]') as HTMLButtonElement).click());
        expect(create).toHaveBeenCalledTimes(1);
        expect(create).toHaveBeenCalledWith(actor.id, '起点', '<!-- title:起点 -->\n清晨，门外有人敲门。');
        expect((host!.querySelector('select[aria-label="选择已有开场"]') as HTMLSelectElement).value).toBe(`${actor.id}::custom-1`);
        expect(field().value).toContain('清晨，门外有人敲门。');
        expect(host!.querySelector('[data-story-opening-settings] textarea')).toBeNull();
        await click('剧情介绍');
        expect(field().value).toBe('');
        await click('开场白');
        await click('保存并进入');
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onSave.mock.calls[0]?.[0].premise).toBe('');
        expect(onSave.mock.calls[0]?.[0].openingGreeting).toEqual({ characterId: actor.id, greetingId: 'custom-1' });
    });

    it('多个角色用紧凑归属选择，取消不写入，选择后只保存给目标角色', async () => {
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        const otherActor = { ...actor, id: 'actor-2', name: '另一角色', tavernGreetings: [] };
        const create = vi.fn(async (_actorId: string, _title: string, content: string) => ({ id: 'custom-2', title: '开场二', content }));
        const props = {
            initial: { ...createStoryTheaterDraft(), characterIds: [actor.id, otherActor.id] },
            characters: [{ ...actor, tavernGreetings: [] }, otherActor],
            user: { name: '用户' } as any, masks: [], maskLocked: false,
            presets: [BUILTIN_NIGHT_SCREENING_PRESET], onCancel: vi.fn(), onSave: vi.fn(),
            onImportPreset: async () => null, onEditPreset: vi.fn(), onOpenMaskBox: vi.fn(), onCreateGreeting: create,
        };
        await act(async () => root!.render(React.createElement(StoryTheaterEditor, props)));
        await typeInto(field(), '为角色二保存的开场');
        await act(async () => (host!.querySelector('[data-story-opening-save]') as HTMLButtonElement).click());
        expect(host!.querySelector('[data-story-opening-target]')).toBeTruthy();
        expect(create).not.toHaveBeenCalled();
        await act(async () => (host!.querySelector<HTMLButtonElement>('button[aria-label="取消收藏开场"]')!).click());
        expect(host!.querySelector('[data-story-opening-target]')).toBeNull();
        expect(field().value).toBe('为角色二保存的开场');
        await act(async () => (host!.querySelector('[data-story-opening-save]') as HTMLButtonElement).click());
        const target = host!.querySelector<HTMLSelectElement>('select[aria-label="开场归属角色"]')!;
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
            setter.call(target, otherActor.id);
            target.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await act(async () => (host!.querySelector<HTMLButtonElement>('button[aria-label="确认收藏开场"]')!).click());
        expect(create).toHaveBeenCalledTimes(1);
        expect(create.mock.calls[0]?.[0]).toBe(otherActor.id);
        expect((host!.querySelector('select[aria-label="选择已有开场"]') as HTMLSelectElement).value).toBe('actor-2::custom-2');
    });

    it('写入失败时不清空草稿也不假装已保存', async () => {
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        const create = vi.fn(async () => { throw new Error('空间不足'); });
        const props = {
            initial: { ...createStoryTheaterDraft(), characterIds: [actor.id] },
            characters: [{ ...actor, tavernGreetings: [] }], user: { name: '用户' } as any,
            masks: [], maskLocked: false, presets: [BUILTIN_NIGHT_SCREENING_PRESET],
            onCancel: vi.fn(), onSave: vi.fn(), onImportPreset: async () => null,
            onEditPreset: vi.fn(), onOpenMaskBox: vi.fn(), onCreateGreeting: create,
        };
        await act(async () => root!.render(React.createElement(StoryTheaterEditor, props)));
        await typeInto(field(), '失败时必须保留的文字');
        await act(async () => (host!.querySelector('[data-story-opening-save]') as HTMLButtonElement).click());
        expect(host!.querySelector('[role="alert"]')?.textContent).toContain('空间不足');
        expect(field().value).toBe('失败时必须保留的文字');
        expect((host!.querySelector('select[aria-label="选择已有开场"]') as HTMLSelectElement).value).toBe('');
    });
});
