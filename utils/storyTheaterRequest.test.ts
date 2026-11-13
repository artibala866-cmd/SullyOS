// @vitest-environment jsdom
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, expect, it, vi } from 'vitest';
import StoryTheaterSession from '../components/date/story/StoryTheaterSession';
import type { Message } from '../types';
import { DB } from './db';
import { MemoryNodeDB } from './memoryPalace/db';
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
    it.each(['事件盒', '独立向量', '已撤销向量', '向量超预算'] as const)('%s：续写读取当前归档或原文，本轮推进排在深度 0 世界书之后', async (mode) => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
        const entry = {
            ...createStoryTheaterDraft(1), title: '夜访', archiveAfter: 200,
            characterIds: ['actor'], selectedWorldbookIds: ['side-door'], forceUserLastMessage: true,
            outputMaxTokens: 30_000, // 旧剧情遗留的本地覆盖不得压住当前预设
        };
        const preset = createBlankStoryPreset('旧预设无历史槽', 1);
        preset.document.prompts = [];
        preset.document.generation.maxTokens = 250_000;
        const charId = storyTheaterThreadId(entry.id);
        const vectorText = '关系变化：林星答应把侧门钥匙交给小雨。';
        if (mode !== '事件盒') {
            await MemoryNodeDB.save({
                id: 'active-'+mode, charId, room: 'living_room', content: mode === '向量超预算' ? vectorText.repeat(400) : vectorText, tags: [], mood: 'neutral',
                embedded: true, createdAt: 1, lastAccessedAt: 1, accessCount: 0, importance: 6,
            });
        }
        const rows: Message[] = Array.from({ length: 13 }, (_, index) => ({
            id: 100 + index * 3, charId, type: 'text', role: index % 2 === 0 ? 'user' : 'assistant',
            content: index === 12 ? '我要打开侧门。' : `楼层内容 ${index + 1}`,
            timestamp: 2000 - index,
            metadata: { source: 'story_theater', theaterId: entry.id, theaterArchived: index < 12,
                ...(index === 8 ? { theaterAffinityInputs: [{ characterId: 'actor', characterName: '林星', delta: 17, awareness: 'unnoticed' }] } : {}),
            },
        }));
        entry.archives = [
            { id: 'old', strategy: 'summary', fromMessageId: rows[0].id, toMessageId: rows[9].id,
                messageCount: 10, summary: '旧约定：先去庭院找钥匙。', createdAt: 1 },
            { id: 'future', strategy: 'summary', fromMessageId: rows[12].id, toMessageId: rows[12].id,
                messageCount: 1, summary: '这一段还未发生', createdAt: 2 },
        ];
        if (mode === '事件盒') {
            // The oldest correction falls outside the eight newest event boxes,
            // but should still reach the prose request without the old scene.
            entry.archives.unshift(...Array.from({ length: 10 }, (_, i) => ({
                id: 'history-' + i, strategy: 'summary' as const, fromMessageId: i * 2 + 1,
                toMessageId: i * 2 + 2, messageCount: 2, createdAt: i,
                summary: i === 0
                    ? '【关键事件与因果】\n旧场景在车站发生。\n\n【未解决事项与续写落点】\n用户协助指令：不替小雨决定离开。'
                    : '旧事件盒普通剧情记录 ' + i,
            })));
        }
        if (mode !== '事件盒') {
            entry.archives = mode !== '已撤销向量'
                ? [{ ...entry.archives[0], summary: undefined, strategy: 'vector', vectorMemoryIds: ['active-'+mode] }]
                : [];
        }
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
            const requestBody = JSON.parse(String(completion.mock.calls[0][1]?.body));
            expect(requestBody.max_tokens).toBe(250_000);
            const payload = requestBody.messages as StoryApiMessage[];
            expect(payload).toContainEqual({ role: 'assistant', content: '[第 12 楼 · 最近一段剧场正文]\n楼层内容 12' });
            const readsOriginal = mode === '已撤销向量' || mode === '向量超预算';
            expect(payload.some(message => message.content.includes('楼层内容 10'))).toBe(readsOriginal);
            expect(payload.some(message => message.content.includes('<delta>+17</delta>'))).toBe(readsOriginal);
            expect(payload.some(message => message.content.includes('楼层内容 11'))).toBe(true);
            expect(payload.filter(message => message.content.includes('旧约定：先去庭院找钥匙。'))).toHaveLength(mode === '事件盒' ? 1 : 0);
            expect(payload.some(message => message.content.includes('较早事件盒的用户协助指令'))).toBe(mode === '事件盒');
            if (mode === '事件盒') {
                expect(payload.some(message => message.content.includes('用户协助指令：不替小雨决定离开。'))).toBe(true);
                expect(payload.some(message => message.content.includes('旧场景在车站发生'))).toBe(false);
                expect(payload.some(message => message.content.includes('事件盒只记录已经发生的关键事件'))).toBe(true);
                expect(payload.some(message => message.content.includes('事件盒记录该楼段结束时的状态'))).toBe(false);
            }
            expect(payload.filter(message => message.content.includes(vectorText))).toHaveLength(mode === '独立向量' ? 1 : 0);
            expect(payload.some(message => message.content.includes('这一段还未发生'))).toBe(false);
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
