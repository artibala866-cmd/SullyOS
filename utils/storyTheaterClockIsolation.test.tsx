// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { OSPreviewProvider } from '../context/OSContext';
import { StoryTheaterThemeProvider } from '../components/date/story/StoryTheaterTheme';
import StoryTheaterSession from '../components/date/story/StoryTheaterSession';
import { createStoryTheaterDraft, BUILTIN_NIGHT_SCREENING_PRESET } from './storyTheater';
import { DB } from './db';
import type { Message } from '../types';

// Count actual old-floor parsing, not just whether a rendered node happened
// to remain connected. OSProvider updates its clock every second in production.
const tracking = vi.hoisted(() => ({ parseCalls: 0 }));
vi.mock('./storyRegexDisplay', async importOriginal => {
    const actual = await importOriginal<typeof import('./storyRegexDisplay')>();
    return {
        ...actual,
        parseStoryRegexDisplay: (...args: Parameters<typeof actual.parseStoryRegexDisplay>) => {
            tracking.parseCalls += 1;
            return actual.parseStoryRegexDisplay(...args);
        },
    };
});
vi.mock('../components/os/TokenImg', () => ({ default: () => null }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('剧情长楼层不被每秒全局时钟反复渲染', () => {
    it('80 楼进入后，连续全局时钟和角色数组更新不重新解析旧楼层', async () => {
        tracking.parseCalls = 0;
        const rows = Array.from({ length: 80 }, (_, index) => ({
            id: index + 1,
            charId: 'story-theater:clock-regression',
            role: index % 2 === 0 ? 'user' : 'assistant',
            type: 'text',
            content: '固定楼层正文 ' + (index + 1),
            timestamp: 1700000000000 + index * 1000,
            metadata: { source: 'story_theater' },
        } as Message));
        const lookup = vi.spyOn(DB, 'getMessagesByCharId').mockResolvedValue(rows);
        const actor = { id: 'clock-actor', name: '林星', avatar: '', systemPrompt: '', memories: [], mountedWorldbooks: [] };
        const entry = { ...createStoryTheaterDraft(), id: 'clock-regression', characterIds: [actor.id], carryCharacterMemory: false };
        const osBase = {
            worldbooks: [], userProfile: { name: '玩家', avatar: '' },
            apiConfig: { baseUrl: '', apiKey: '', model: '' },
            memoryPalaceConfig: {}, remoteVectorConfig: {},
            theme: { storyAppearance: { preset: 'novel' } },
            updateCharacter: () => {}, addToast: () => {}, registerBackHandler: () => () => {},
        } as any;
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        const masks: never[] = [];
        const onBack = () => {};
        const onEntryChange = () => {};
        const renderClock = (second: number) => root.render(
            <OSPreviewProvider value={{
                ...osBase,
                virtualTime: { hours: 12, minutes: 0, day: 'Mon', seconds: second },
                characters: [{ ...actor }],
            }}>
                <StoryTheaterThemeProvider>
                    <StoryTheaterSession entry={entry} preset={BUILTIN_NIGHT_SCREENING_PRESET}
                        masks={masks} onBack={onBack} onEdit={onBack}
                        onEntryChange={onEntryChange} onArchiveCommitted={onBack} />
                </StoryTheaterThemeProvider>
            </OSPreviewProvider>,
        );
        try {
            await act(async () => renderClock(0));
            await vi.waitFor(async () => {
                await act(async () => {});
                expect(host.querySelectorAll('[data-story-floor]')).toHaveLength(80);
            });
            const firstParagraph = host.querySelectorAll('[data-story-floor]')[1].querySelector('.meeting-prose');
            const initialParses = tracking.parseCalls;
            expect(initialParses).toBeGreaterThanOrEqual(40);
            for (let tick = 1; tick <= 8; tick += 1) {
                await act(async () => renderClock(tick));
                expect(host.querySelectorAll('[data-story-floor]')).toHaveLength(80);
                expect(host.textContent).toContain('固定楼层正文 80');
                expect(firstParagraph?.isConnected).toBe(true);
                expect(tracking.parseCalls).toBe(initialParses);
            }
            expect(lookup).toHaveBeenCalledTimes(1);
        } finally {
            await act(async () => root.unmount());
            host.remove();
            lookup.mockRestore();
        }
    });
});
