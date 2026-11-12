// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../types';
import { DB } from './db';
import { OSPreviewProvider } from '../context/OSContext';
import { StoryTheaterThemeProvider } from '../components/date/story/StoryTheaterTheme';
import StoryTheaterSession from '../components/date/story/StoryTheaterSession';
import { BUILTIN_NIGHT_SCREENING_PRESET, createStoryTheaterDraft, storyTheaterThreadId } from './storyTheater';

vi.mock('../components/os/TokenImg', () => ({ default: () => null }));
vi.mock('./storyRegexRunner', () => ({
    runStoryRegex: async (inputs: Array<string | { text: string }>) =>
        inputs.map(x => ({ text: typeof x === 'string' ? x : x.text, cards: [], matches: 0 })),
}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const scrollTo = HTMLElement.prototype.scrollTo;
const actor = { id: 'chaos-npc', name: '林星', avatar: '', memories: [], mountedWorldbooks: [], systemPrompt: '' };
const entry = {
    ...createStoryTheaterDraft(), id: 'chaos-arc-a', title: '雨夜的第九十五层',
    characterIds: [actor.id], archiveAfter: 120, carryCharacterMemory: false, readingBatchSize: 20,
    archives: [{ id: 'chaos-archive-a', strategy: 'summary' as const,
        fromMessageId: 1, toMessageId: 75, messageCount: 75,
        summary: '旧雨夜约定', createdAt: 1700000000000 }],
};
const makeRows = (id: string, count: number, archivedUntil: number): Message[] =>
    Array.from({ length: count }, (_, i) => ({
        id: i + 1,
        charId: storyTheaterThreadId(id),
        type: 'text', role: i % 2 ? 'assistant' : 'user',
        content: '原文楼层标识=' + String(i + 1).padStart(3, '0') + ' / ' + '雨夜特别长的对白。'.repeat(16),
        timestamp: 1700000000000 + i,
        metadata: {
            source: 'story_theater', theaterId: id,
            ...(i + 1 <= archivedUntil ? { theaterArchived: true } : {}),
        },
    } as Message));
const data = makeRows(entry.id, 95, 75);
const fakeOs = {
    characters: [actor], worldbooks: [], userProfile: { name: '玩家', avatar: '' },
    apiConfig: { baseUrl: '', apiKey: '', model: '' },
    memoryPalaceConfig: {}, remoteVectorConfig: {},
    theme: { storyAppearance: { preset: 'none' } },
    updateCharacter: () => {}, addToast: vi.fn(), registerBackHandler: () => () => {},
} as any;

const view = (story: typeof entry = entry) =>
    React.createElement(OSPreviewProvider, { value: fakeOs },
        React.createElement(StoryTheaterThemeProvider, null,
            React.createElement(StoryTheaterSession, {
                key: story.id, entry: story, preset: BUILTIN_NIGHT_SCREENING_PRESET,
                masks: [], onBack: () => {}, onEdit: () => {},
                onEntryChange: () => {}, onArchiveCommitted: () => {},
            })));

async function mount(story: typeof entry = entry) {
    if (!host) {
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        HTMLElement.prototype.scrollTo = vi.fn();
    }
    await act(async () => root!.render(view(story)));
    return host!;
}
const clickOlder = async () => {
    const button = host!.querySelector<HTMLButtonElement>('[data-story-load-more]');
    expect(button, '旧楼层加载按钮没有出现').not.toBeNull();
    await act(async () => button!.click());
};
const toggle = async (node: HTMLDetailsElement, open: boolean) =>
    act(async () => {
        node.open = open;
        node.dispatchEvent(new Event('toggle', { bubbles: false }));
        await Promise.resolve();
    });

afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = null; host?.remove(); host = null;
    HTMLElement.prototype.scrollTo = scrollTo;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('真实玩家不按常理过剧情：分批、归档、生成隔离', () => {
    it('回到95楼后猛点十次加载旧20层：不能多加载或改变楼号；归档原文默认不在界面', async () => {
        const read = vi.spyOn(DB, 'getRecentMessagesWithCount').mockImplementation(async (id, limit, accept) =>
            ({ messages: data.filter(x => x.charId === id && (!accept || accept(x))).slice(-limit), totalCount: 95 }));
        const body = vi.spyOn(DB, 'getMessageById').mockImplementation(async id =>
            data.find(x => x.id === id) || null);
        const fetchSpy = vi.fn(() => { throw new Error('滑动翻阅绝不应调用模型'); });
        vi.stubGlobal('fetch', fetchSpy);
        const page = await mount();
        expect(page.querySelectorAll('[data-story-floor]')).toHaveLength(20);
        expect(page.querySelector('[data-story-floor="76"]')).toBeTruthy();
        expect(page.querySelector('[data-story-floor="95"]')).toBeTruthy();
        const button = page.querySelector<HTMLButtonElement>('[data-story-load-more]')!;
        await act(async () => { for (let i = 0; i < 10; i++) button.click(); });
        expect(read.mock.calls.filter(([, n]) => n === 40)).toHaveLength(1);
        expect(read.mock.calls.some(([, n]) => n > 40)).toBe(false);
        expect(page.querySelector('[data-story-floor="56"]')).toBeTruthy();
        expect(page.querySelector('[data-story-floor="95"]')).toBeTruthy();
        expect(page.querySelectorAll('.story-archive-range')).toHaveLength(1);
        expect(page.textContent).not.toContain('原文楼层标识=056');
        expect(body).not.toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
        await clickOlder();
        expect(page.querySelector('[data-story-floor="36"]')).toBeTruthy();
        expect(page.querySelector('[data-story-floor="95"]')).toBeTruthy();
        expect(read.mock.calls.filter(([, n]) => n === 60)).toHaveLength(1);
    }, 30000);

    it('打开归档又立刻收起，在旧原文还没读取完时离开：延迟返回不可偷偷重现', async () => {
        const read = vi.spyOn(DB, 'getRecentMessagesWithCount').mockImplementation(async (id, limit) =>
            ({ messages: data.filter(x => x.charId === id).slice(-limit), totalCount: 95 }));
        const pending: Array<() => void> = [];
        const body = vi.spyOn(DB, 'getMessageById').mockImplementation(id =>
            new Promise<Message | null>(resolve => pending.push(() => resolve(data.find(x => x.id === id) || null))));
        const page = await mount();
        await clickOlder();
        const details = page.querySelector<HTMLDetailsElement>('.story-archive-range > details')!;
        expect(details).toBeTruthy();
        expect(page.textContent).not.toContain('原文楼层标识=056');
        await toggle(details, true);
        expect(body).toHaveBeenCalled();
        expect(page.textContent).toContain('正在读取原文');
        await toggle(details, false);
        await act(async () => { pending.splice(0).forEach(release => release()); await Promise.resolve(); });
        expect(page.querySelector('.story-archive-content')).toBeNull();
        expect(page.textContent).not.toContain('原文楼层标识=056');
        body.mockImplementation(async id => data.find(x => x.id === id) || null);
        await toggle(details, true);
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(page.textContent).toContain('原文楼层标识=056');
        await toggle(details, false);
        expect(page.querySelector('.story-archive-content')).toBeNull();
        expect(page.textContent).not.toContain('原文楼层标识=056');
        expect(read.mock.calls.some(([, limit]) => limit > 40)).toBe(false);
    }, 30000);

    it('打开旧归档后马上关闭再重开：第一次慢响应不能覆盖第二次看到的新原文', async () => {
        vi.spyOn(DB, 'getRecentMessagesWithCount').mockImplementation(async (id, limit) =>
            ({ messages: data.filter(x => x.charId === id).slice(-limit), totalCount: 95 }));
        let phase: 'first' | 'second' = 'first';
        const oldReplies: Array<() => void> = [];
        const body = vi.spyOn(DB, 'getMessageById').mockImplementation(id => {
            const original = data.find(row => row.id === id) || null;
            if (phase === 'first') return new Promise<Message | null>(resolve =>
                oldReplies.push(() => resolve(original)));
            return Promise.resolve(original && { ...original, content: '更新后的原文B-' + id });
        });
        const page = await mount();
        await clickOlder();
        const details = page.querySelector<HTMLDetailsElement>('.story-archive-range > details')!;
        await toggle(details, true);
        expect(oldReplies.length).toBeGreaterThan(0);
        await toggle(details, false);
        phase = 'second';
        await toggle(details, true);
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(page.textContent).toContain('更新后的原文B-56');
        await act(async () => { oldReplies.splice(0).forEach(done => done()); await Promise.resolve(); });
        expect(page.textContent).toContain('更新后的原文B-56');
        expect(page.textContent).not.toContain('原文楼层标识=056');
        expect(body).toHaveBeenCalled();
    }, 30000);

    it('点开归档时手机存储报错，但用户已经收起：不能过几秒突然弹旧错误', async () => {
        vi.spyOn(DB, 'getRecentMessagesWithCount').mockImplementation(async (id, limit) =>
            ({ messages: data.filter(x => x.charId === id).slice(-limit), totalCount: 95 }));
        const rejectOld: Array<() => void> = [];
        const body = vi.spyOn(DB, 'getMessageById').mockImplementation(() =>
            new Promise<Message | null>((_resolve, reject) =>
                rejectOld.push(() => reject(new Error('旧归档已收起，读盘错误不应打扰玩家')))));
        fakeOs.addToast.mockClear();
        const page = await mount();
        await clickOlder();
        const details = page.querySelector<HTMLDetailsElement>('.story-archive-range > details')!;
        await toggle(details, true);
        expect(body).toHaveBeenCalled();
        await toggle(details, false);
        await act(async () => { rejectOld.splice(0).forEach(reject => reject()); await Promise.resolve(); });
        expect(page.textContent).not.toContain('原文暂不可读取');
        expect(fakeOs.addToast).not.toHaveBeenCalled();
        body.mockImplementation(async id => data.find(row => row.id === id) || null);
        await toggle(details, true);
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(page.querySelector('.story-archive-content')).not.toBeNull();
    }, 30000);

    it('旧20层在慢速读取时直接切换另一部剧情：旧查询回调不能污染新剧本', async () => {
        const b = { ...entry, id: 'chaos-arc-b', title: '另一篇剧情',
            archives: [], readingBatchSize: 10 };
        const bRows = makeRows(b.id, 13, 0).map(row =>
            ({ ...row, content: '另一部剧情的唯一标记 B-' + row.id }));
        let releaseOlder: (() => void) | undefined;
        const read = vi.spyOn(DB, 'getRecentMessagesWithCount').mockImplementation(async (id, limit) => {
            if (id === storyTheaterThreadId(entry.id) && limit === 40) {
                return new Promise(resolve => {
                    releaseOlder = () => resolve({ messages: data.slice(-40), totalCount: 95 });
                });
            }
            if (id === storyTheaterThreadId(b.id)) return { messages: bRows.slice(-limit), totalCount: 13 };
            return { messages: data.slice(-limit), totalCount: 95 };
        });
        const page = await mount();
        await clickOlder();
        expect(releaseOlder).toBeTruthy();
        await mount(b);
        expect(page.textContent).toContain('另一部剧情的唯一标记 B-');
        expect(page.textContent).not.toContain('原文楼层标识=095');
        await act(async () => { releaseOlder?.(); await Promise.resolve(); });
        expect(page.textContent).toContain('另一部剧情的唯一标记 B-');
        expect(page.querySelector('[data-story-floor="13"]')).toBeTruthy();
        expect(page.querySelector('[data-story-floor="95"]')).toBeNull();
        expect(read.mock.calls.some(([id]) => id === storyTheaterThreadId(b.id))).toBe(true);
    }, 30000);
});
