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
});
