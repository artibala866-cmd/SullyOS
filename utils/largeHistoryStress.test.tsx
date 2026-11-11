// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { Message } from '../types';
import { DB, openDB } from './db';
import { OSPreviewProvider } from '../context/OSContext';
import { StoryTheaterThemeProvider } from '../components/date/story/StoryTheaterTheme';
import StoryTheaterSession from '../components/date/story/StoryTheaterSession';
import { BUILTIN_NIGHT_SCREENING_PRESET, createStoryTheaterDraft, storyTheaterThreadId } from './storyTheater';
import { applyStoryRegex } from './storyRegex';
import type { StoryRegexRule } from './storyRegex';

vi.mock('./storyRegexRunner', () => ({
    runStoryRegex: async (texts: string[], rules: StoryRegexRule[], stage: 'display' | 'history') =>
        texts.map(text => applyStoryRegex(text, rules, stage)),
}));
vi.mock('../components/os/TokenImg', () => ({ default: () => null }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('isolated large-history load (never uses player saves)', () => {
    it('reads 1,200 story floors and 5,000 private messages in bounded recent windows without losing old rows', async () => {
        const marker = 'stress-' + Date.now();
        const storyId = storyTheaterThreadId(marker);
        const chatId = 'stress-chat-' + marker;
        const db = await openDB();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('messages', 'readwrite');
            const store = tx.objectStore('messages');
            for (let i = 1; i <= 1200; i++) {
                store.add({
                    charId: storyId, role: i % 2 ? 'user' : 'assistant', type: 'text',
                    content: '剧情楼层 ' + i + ' / ' + '一段很长的剧情。'.repeat(20),
                    timestamp: 1700000000000 + i,
                    metadata: { source: 'story_theater', theaterId: marker, theaterArchived: i <= 900 },
                });
            }
            for (let i = 1; i <= 5000; i++) {
                store.add({
                    charId: chatId, role: i % 2 ? 'user' : 'assistant', type: 'text',
                    content: '私聊第 ' + i + ' 条消息。' + '长聊天记录。'.repeat(12),
                    timestamp: 1700000100000 + i,
                });
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
        const story = await DB.getRecentMessagesWithCount(storyId, 20, row => row.metadata?.source === 'story_theater');
        expect(story.totalCount).toBe(1200);
        expect(story.messages).toHaveLength(20);
        expect(story.messages[0].content).toContain('1181');
        expect(story.messages.at(-1)?.content).toContain('1200');
        const allStory = await DB.getMessagesByCharId(storyId, true);
        expect(allStory).toHaveLength(1200);
        expect(allStory.filter(row => row.metadata?.theaterArchived)).toHaveLength(900);
        for (let i = 0; i < 15; i++) {
            const recent = await DB.getRecentMessagesWithCount(chatId, 100);
            expect(recent.totalCount).toBe(5000);
            expect(recent.messages).toHaveLength(100);
            expect(recent.messages[0].content).toContain('4901');
            expect(recent.messages.at(-1)?.content).toContain('5000');
        }
        const fullChat = await DB.getMessagesByCharId(chatId, true);
        expect(fullChat).toHaveLength(5000);
        expect(fullChat[0].content).toContain('第 1 条');
    }, 90000);

    it('mounts 1,000 actual story floors, pages through history, repeatedly expands archived groups and reenters', async () => {
        const entryId = 'large-ui-stress-' + Date.now();
        const threadId = storyTheaterThreadId(entryId);
        const rows = Array.from({ length: 1000 }, (_, index) => {
            const floor = index + 1;
            return {
                id: floor, charId: threadId, role: floor % 2 ? 'user' : 'assistant',
                type: 'text', content: '第 ' + floor + ' 楼 / ' + '剧情文字。'.repeat(20),
                timestamp: 1700000000000 + floor,
                metadata: { source: 'story_theater', theaterId: entryId, ...(floor <= 800 ? { theaterArchived: true } : {}) },
            } as Message;
        });
        const entry = {
            ...createStoryTheaterDraft(), id: entryId, title: '千层归档压力测试',
            readingBatchSize: 100, characterIds: ['stress-actor'], carryCharacterMemory: false,
            archives: Array.from({ length: 8 }, (_, index) => ({
                id: 'stress-box-' + index, strategy: 'summary' as const,
                fromMessageId: index * 100 + 1, toMessageId: index * 100 + 100,
                messageCount: 100, summary: '测试归档摘要 ' + index, createdAt: 1,
            })),
        };
        const os = {
            characters: [{ id: 'stress-actor', name: '测试角色', avatar: '', memories: [], mountedWorldbooks: [] }],
            worldbooks: [], userProfile: { name: '用户', avatar: '' },
            apiConfig: { baseUrl: '', apiKey: '', model: '' },
            memoryPalaceConfig: {}, remoteVectorConfig: {},
            theme: { storyAppearance: { preset: 'none' } },
            updateCharacter: () => {}, addToast: vi.fn(), registerBackHandler: () => () => {},
        } as any;
        const spy = vi.spyOn(DB, 'getRecentMessagesWithCount').mockImplementation(async (charId, limit) => {
            expect(charId).toBe(threadId);
            return { messages: rows.slice(-limit), totalCount: rows.length };
        });
        const fetchSpy = vi.fn(() => { throw new Error('Stress test must not call any model API'); });
        vi.stubGlobal('fetch', fetchSpy);
        const originalScrollTo = HTMLElement.prototype.scrollTo;
        HTMLElement.prototype.scrollTo = vi.fn();
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        const view = () => <OSPreviewProvider value={os}><StoryTheaterThemeProvider>
            <StoryTheaterSession entry={entry} preset={BUILTIN_NIGHT_SCREENING_PRESET}
                masks={[]} onBack={() => {}} onEdit={() => {}} onEntryChange={() => {}} onArchiveCommitted={() => {}} />
        </StoryTheaterThemeProvider></OSPreviewProvider>;
        try {
            await act(async () => root.render(view()));
            expect(host.querySelectorAll('[data-story-floor]')).toHaveLength(100);
            expect(host.textContent).toContain('第 1000 楼');
            for (let i = 0; i < 9; i++) {
                const loadMore = host.querySelector<HTMLButtonElement>('[data-story-load-more]');
                expect(loadMore, 'missing older-floor button after ' + i + ' loads').not.toBeNull();
                await act(async () => loadMore!.click());
            }
            expect(host.querySelector('[data-story-load-more]')).toBeNull();
            expect(host.querySelectorAll('[data-story-floor]')).toHaveLength(208);
            const archived = [...host.querySelectorAll<HTMLDetailsElement>('.story-reading-floor > details')];
            expect(archived).toHaveLength(8);
            expect(host.querySelectorAll('.story-reading-floor > details section')).toHaveLength(0);
            for (let i = 0; i < 5; i++) {
                const detail = archived[i % archived.length];
                await act(async () => {
                    detail.open = true;
                    detail.dispatchEvent(new Event('toggle', { bubbles: true }));
                });
                expect(detail.querySelectorAll('section')).toHaveLength(100);
                await act(async () => {
                    detail.open = false;
                    detail.dispatchEvent(new Event('toggle', { bubbles: true }));
                });
                expect(detail.querySelectorAll('section')).toHaveLength(0);
            }
            for (let i = 0; i < 6; i++) {
                await act(async () => root.render(<div data-stress-other-page='true'>另一个页面</div>));
                expect(host.querySelector('[data-story-floor]')).toBeNull();
                await act(async () => root.render(view()));
                expect(host.querySelectorAll('[data-story-floor]')).toHaveLength(100);
                expect(host.textContent).toContain('第 1000 楼');
            }
            expect(fetchSpy).not.toHaveBeenCalled();
            expect(spy).toHaveBeenCalled();
        } finally {
            await act(async () => root.unmount());
            host.remove();
            HTMLElement.prototype.scrollTo = originalScrollTo;
            vi.restoreAllMocks();
            vi.unstubAllGlobals();
        }
    }, 90000);
});
