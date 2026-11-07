// @vitest-environment jsdom
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, expect, it, vi } from 'vitest';
import StoryTheaterSession from '../components/date/story/StoryTheaterSession';
import type { Message } from '../types';
import { DB } from './db';
import { createBlankStoryPreset, createStoryTheaterDraft, storyTheaterThreadId, type StoryApiMessage } from './storyTheater';

const state = vi.hoisted(() => ({
    characters: [{ id: 'actor', name: '林星', description: '向导' }],
    worldbooks: [{
        id: 'side-door', title: '侧门', content: '侧门通向庭院。',
        key: ['侧门'], constant: false, position: 4, depth: 0, role: 1,
    }],
    userProfile: { name: '小雨' },
    apiConfig: { baseUrl: 'https://example.test/v1', apiKey: 'fake', model: 'test' },
    memoryPalaceConfig: {}, addToast: vi.fn(), theme: {},
}));
vi.mock('../context/OSContext', () => ({ useOS: () => state }));

describe('见面剧情实际请求', () => {
    it('第 13 楼重试携带第 12 楼原文，并让本轮推进排在深度 0 世界书之后', async () => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
        const entry = {
            ...createStoryTheaterDraft(1), title: '夜访', archiveAfter: 200,
            characterIds: ['actor'], selectedWorldbookIds: ['side-door'], forceUserLastMessage: true,
        };
        const preset = createBlankStoryPreset('旧预设无历史槽', 1);
        preset.document.prompts = [];
        const charId = storyTheaterThreadId(entry.id);
        const rows: Message[] = Array.from({ length: 13 }, (_, index) => ({
            id: 100 + index * 3, charId, type: 'text', role: index % 2 === 0 ? 'user' : 'assistant',
            content: index === 12 ? '我要打开侧门。' : `楼层内容 ${index + 1}`,
            timestamp: 2000 - index,
            metadata: { source: 'story_theater', theaterId: entry.id, theaterArchived: index < 12 },
        }));
        vi.spyOn(DB, 'getMessagesByCharId').mockImplementation(async () => [...rows].reverse());
        const save = vi.spyOn(DB, 'saveStoryTheaterTurn').mockImplementation(async row => {
            rows.push({ ...row, id: 150 });
            return 150;
        });
        const completion = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
            choices: [{ message: { content: '门后是庭院。' } }],
        })));
        vi.stubGlobal('fetch', completion);
        const container = document.createElement('div');
        document.body.append(container);
        const root = createRoot(container);
        try {
            await act(async () => {
                root.render(React.createElement(StoryTheaterSession, {
                    entry, preset, masks: [], onBack: vi.fn(), onEdit: vi.fn(),
                    onEntryChange: vi.fn(), onArchiveCommitted: vi.fn(),
                }));
            });
            const retry = container.querySelector<HTMLButtonElement>('button[title="继续上次中断"]');
            expect(retry).toBeTruthy();
            await act(async () => { retry!.click(); });
            expect(completion).toHaveBeenCalledOnce();
            const payload = JSON.parse(String(completion.mock.calls[0][1]?.body)).messages as StoryApiMessage[];
            expect(payload).toContainEqual({ role: 'assistant', content: '[第 12 楼 · 最近一段剧场正文]\n楼层内容 12' });
            expect(payload.some(message => message.content.includes('楼层内容 10'))).toBe(false);
            expect(payload.at(-2)?.content).toBe('侧门通向庭院。');
            expect(payload.at(-1)).toEqual({ role: 'user', content: '[第 13 楼 · 本轮用户推进]\n我要打开侧门。' });
            expect(save).toHaveBeenCalledOnce();
            expect(save.mock.calls[0][0]).toMatchObject({ role: 'assistant', metadata: { theaterReplyToUserId: 136 } });
        } finally {
            await act(async () => root.unmount());
            container.remove();
            Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
            vi.restoreAllMocks();
            vi.unstubAllGlobals();
        }
    });
});
