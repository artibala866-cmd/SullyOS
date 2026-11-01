// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DB } from './db';
import StoryTheater from '../components/date/story/StoryTheater';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const actor = { id: 'full-flow-actor', name: '旅行者', avatar: '', mountedWorldbooks: [], memories: [], systemPrompt: '普通角色' };
const toast = vi.fn();
vi.mock('../context/OSContext', () => ({
    useOS: () => ({ characters: [actor], userProfile: { name: '用户' }, addToast: toast, remoteVectorConfig: {} }),
}));
vi.mock('../components/os/TokenImg', () => ({ default: () => null }));
vi.mock('../components/date/story/StoryTheaterTheme', () => ({
    StoryAppearanceButton: () => null,
    StoryTheaterThemeProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));
vi.mock('../components/date/story/StoryTheaterSession', () => ({
    default: ({ entry, onBack }: any) => React.createElement('main', { 'data-testid': 'saved-story-session' },
        React.createElement('h1', null, entry.title),
        React.createElement('button', { onClick: onBack }, '返回剧情列表')),
}));
let root: Root | null = null, host: HTMLElement | null = null;
async function mount() {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(React.createElement(StoryTheater, { onSwitchCompanion: () => {}, onClose: () => {} })));
}
async function unmount() { if (root) await act(async () => root!.unmount()); root = null; host?.remove(); host = null; }
afterEach(async () => { await unmount(); vi.clearAllMocks(); });
async function tap(text: string) {
    const button = [...host!.querySelectorAll('button')].find(el => el.textContent?.trim() === text);
    expect(button, `missing clickable control ${text}`).toBeTruthy();
    await act(async () => button!.click());
}
async function setTitle(title: string) {
    const input = host!.querySelector('input[placeholder="剧情名称"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter!.call(input, title);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(input.value).toBe(title);
}
describe('见面剧情从点击到真实数据库持久化，再次进入的完整闭环', () => {
    it('不要求隐藏开关，填写标题和选择角色后进入会话，退出重启仍能打开原剧情', async () => {
        await mount();
        const newStory = host!.querySelector('button[aria-label="新建剧情"]') as HTMLButtonElement;
        expect(newStory).toBeTruthy();
        await act(async () => newStory.click());
        await setTitle('真正保存的雨夜');
        await tap('旅行者');
        await tap('保存并进入');
        expect(host!.querySelector('[data-testid="saved-story-session"]')?.textContent).toContain('真正保存的雨夜');
        const saved = (await DB.getStoryTheaters()).find(item => item.title === '真正保存的雨夜');
        expect(saved?.characterIds).toContain(actor.id);
        await unmount();
        await mount();
        await tap('真正保存的雨夜');
        expect(host!.querySelector('[data-testid="saved-story-session"]')?.textContent).toContain('真正保存的雨夜');
        expect((await DB.getStoryTheaters()).find(item => item.id === saved!.id)?.title).toBe('真正保存的雨夜');
    });
});
