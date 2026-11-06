// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DB } from './db';
import StoryTheater from '../components/date/story/StoryTheater';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const actor = { id: 'full-flow-actor', name: '旅行者', avatar: '', mountedWorldbooks: [], memories: [], systemPrompt: '普通角色', tavernGreetings: [] as { id: string; title: string; content: string }[] };
const toast = vi.fn();
vi.mock('../context/OSContext', () => ({
    useOS: () => ({ characters: [actor], userProfile: { name: '用户' }, addToast: toast, remoteVectorConfig: {}, updateCharacter: (_id: string, changes: any) => Object.assign(actor, changes) }),
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
    const button = [...host!.querySelectorAll('button')].find(el =>
        el.getAttribute('aria-label') === text || el.textContent?.trim() === text);
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
    it('自写开场不依赖导入，落入角色数据库后重启仍可作为已有开场选择', async () => {
        actor.tavernGreetings = [];
        await DB.saveCharacter(actor as any);
        await mount();
        const create = host!.querySelector('button[aria-label="新建剧情"]') as HTMLButtonElement;
        await act(async () => create.click());
        await setTitle('用户自己写开场');
        await tap('旅行者');
        const textarea = host!.querySelector('textarea[aria-label="剧情介绍"]') as HTMLTextAreaElement;
        expect(textarea).toBeTruthy();
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
            setter.call(textarea, '雨后的小巷里，有人正等着我。');
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
        });
        const bookmark = host!.querySelector<HTMLButtonElement>('button[aria-label="收藏为可选开场"]')!;
        expect(bookmark?.disabled).toBe(false);
        await act(async () => bookmark.click());
        const persisted = await DB.getCharacter(actor.id);
        expect(persisted?.tavernGreetings?.length).toBe(1);
        expect(persisted?.tavernGreetings?.[0].content).toBe('雨后的小巷里，有人正等着我。');
        expect((host!.querySelector('select[aria-label="选择已有开场"]') as HTMLSelectElement).value)
            .toBe(`${actor.id}::${persisted!.tavernGreetings![0].id}`);
        await unmount();
        await mount();
        await act(async () => (host!.querySelector('button[aria-label="新建剧情"]') as HTMLButtonElement).click());
        await tap('旅行者');
        const choice = host!.querySelector('select[aria-label="选择已有开场"]') as HTMLSelectElement;
        expect(choice.textContent).toContain('雨后的小巷里');
        expect(choice.querySelector('option[value$="' + persisted!.tavernGreetings![0].id + '"]')).toBeTruthy();
    });
    it('不要求隐藏开关，填写标题和选择角色后进入会话，退出重启仍能打开原剧情', async () => {
        await mount();
        const newStory = host!.querySelector('button[aria-label="新建剧情"]') as HTMLButtonElement;
        expect(newStory).toBeTruthy();
        await act(async () => newStory.click());
        await setTitle('真正保存的雨夜');
        await tap('旅行者');
        await tap('保存并进入');
        // fake-indexeddb completes the readwrite transaction on a later task; React must flush after commit.
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
        const firstSession = host!.querySelector('[data-testid="saved-story-session"]');
        expect(firstSession, `No session: alert=${host!.querySelector('[role="alert"]')?.textContent || 'none'}; buttons=${[...host!.querySelectorAll('button')].map(b=>b.textContent?.trim()).filter(Boolean).slice(0,9).join(',')}; stored=${(await DB.getStoryTheaters()).map(x=>x.title).join(',')}`).not.toBeNull();
        expect(firstSession!.textContent).toContain('真正保存的雨夜');
        const saved = (await DB.getStoryTheaters()).find(item => item.title === '真正保存的雨夜');
        expect(saved?.characterIds).toContain(actor.id);
        await unmount();
        await mount();
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
        // Saved story cards include cast/date metadata; click the card by its h3 title.
        const savedCard = [...host!.querySelectorAll('button')].find(b => b.querySelector('h3')?.textContent?.trim() === '真正保存的雨夜');
        expect(savedCard, `saved story card missing: ${host!.textContent?.slice(0,320)}`).toBeTruthy();
        await act(async () => savedCard!.click());
        expect(host!.querySelector('[data-testid="saved-story-session"]')?.textContent).toContain('真正保存的雨夜');
        expect((await DB.getStoryTheaters()).find(item => item.id === saved!.id)?.title).toBe('真正保存的雨夜');
    });
    it('自写收藏的开场进入剧情只生成一条首幕，再进入也不重复', async () => {
        actor.tavernGreetings=[];
        await DB.saveCharacter(actor as any);
        await mount();
        await act(async()=>host!.querySelector<HTMLButtonElement>('button[aria-label="新建剧情"]')!.click());
        await setTitle('用户自写首幕原子检查');
        await tap('旅行者');
        const textarea=host!.querySelector<HTMLTextAreaElement>('textarea[aria-label="剧情介绍"]')!;
        await act(async()=>{
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(textarea,'{{char}}在旧桥边等{{user}}。');
            textarea.dispatchEvent(new Event('input',{bubbles:true}));
        });
        await tap('收藏为可选开场');
        // IndexedDB completion can happen on a later task than the click handler.
        await act(async()=>{await new Promise(resolve=>setTimeout(resolve,80));});
        expect(host!.querySelector<HTMLTextAreaElement>('textarea[aria-label="编辑开场内容"]')?.value).toBe('{{char}}在旧桥边等{{user}}。');
        await tap('保存并进入');
        await act(async()=>{await new Promise(resolve=>setTimeout(resolve,80));});
        const entries=await DB.getStoryTheaters();
        const saved=entries.find(row=>row.title==='用户自写首幕原子检查');
        expect(saved).toBeTruthy();
        expect(saved?.premise).toBe('');
        const all=await DB.getMessagesByCharId(`story-theater:${saved!.id}`,true);
        const first=all.filter(row=>row.metadata?.source==='story_theater');
        expect(first).toHaveLength(1);
        expect(first[0].content).toContain('旅行者在旧桥边等用户');
        await unmount();
        await mount();
        await act(async()=>{await new Promise(resolve=>setTimeout(resolve,40));});
        const card=[...host!.querySelectorAll('button')].find(b=>b.querySelector('h3')?.textContent?.trim()==='用户自写首幕原子检查');
        expect(card).toBeTruthy();
        await act(async()=>card!.click());
        const after=(await DB.getMessagesByCharId(`story-theater:${saved!.id}`,true))
            .filter(row=>row.metadata?.source==='story_theater');
        expect(after).toHaveLength(1);
    });

});
