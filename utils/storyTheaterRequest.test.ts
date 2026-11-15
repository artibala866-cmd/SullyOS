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
    it.each(['事件盒', '独立向量', '已撤销向量', '向量超预算', '增量事实', '向量节点缺失', '向量读取失败', '补查旧原文'] as const)('%s：续写读取当前归档或原文，本轮推进排在深度 0 世界书之后', async (mode) => {
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
        const evidence = mode === '补查旧原文';
        const textFallback = mode === '向量节点缺失' || mode === '向量读取失败' || evidence;
        if (mode !== '事件盒' && mode !== '增量事实' && !textFallback) {
            await MemoryNodeDB.save({
                id: 'active-'+mode, charId, room: 'living_room', content: mode === '向量超预算' ? vectorText.repeat(400) : vectorText, tags: [], mood: 'neutral',
                embedded: true, createdAt: 1, lastAccessedAt: 1, accessCount: 0, importance: 6,
            });
        }
        const rows: Message[] = Array.from({ length: 13 }, (_, index) => ({
            id: 100 + index * 3, charId, type: 'text', role: index % 2 === 0 ? 'user' : 'assistant',
            content: index === 12 ? (evidence ? '侧门的回执编号是多少？' : '我要打开侧门。')
                : evidence && index === 7 ? '交接完成，回执编号是 74851。' : `楼层内容 ${index + 1}`,
            timestamp: 2000 - index,
            metadata: { source: 'story_theater', theaterId: entry.id, theaterArchived: index < 12,
                ...(index === 8 ? { theaterAffinityInputs: [{ characterId: 'actor', characterName: '林星', delta: 17, awareness: 'unnoticed' }] } : {}),
            },
        }));
        entry.archives = [
            { id: 'old', strategy: 'summary', fromMessageId: rows[0].id, toMessageId: rows[9].id,
                messageCount: 10, summary: '旧约定：先去庭院找钥匙。', createdAt: 1 },
            { id: 'future', strategy: 'summary', fromMessageId: rows[12].id + 1, toMessageId: rows[12].id + 1,
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
        if (mode !== '事件盒' && mode !== '增量事实' && !textFallback) {
            entry.archives = mode !== '已撤销向量'
                ? [{ ...entry.archives[0], summary: undefined, strategy: 'vector', vectorMemoryIds: ['active-'+mode] }]
                : [];
        }
        if (mode === '增量事实' || textFallback) {
            const key = '侧门钥匙/持有人';
            const fact = { key, kind: 'fact' as const, terms: ['侧门', '钥匙'] };
            const id = 'fallback-' + entry.id;
            const storage = textFallback ? { strategy: 'vector' as const, vectorMemoryIds: [id] } : { strategy: 'summary' as const };
            const binding = textFallback ? { vectorNodeId: id, vectorTextState: 'synced' as const } : {};
            entry.archives = [
                { ...entry.archives[0], ...(evidence ? { strategy: 'vector' as const, vectorMemoryIds: [] } : {}), facts: [{ ...fact, text: '林星保管钥匙。', sourceMessageId: rows[0].id }] },
                { id: 'latest', ...storage, fromMessageId: rows[10].id, toMessageId: rows[10].id, messageCount: 1, createdAt: 2,
                    facts: [{ ...fact, ...binding, text: '钥匙现在由小雨保管。', sourceMessageId: rows[10].id }] },
                entry.archives[1],
            ];
        }
        if (textFallback) await DB.saveStoryTheater(entry);
        if (mode === '向量读取失败') {
            vi.spyOn(MemoryNodeDB, 'getByCharId').mockRejectedValueOnce(new Error('索引暂时不可用'));
            vi.spyOn(MemoryNodeDB, 'getById').mockRejectedValueOnce(new Error('节点暂时不可用'));
        }
        vi.spyOn(DB, 'getRecentMessagesWithCount').mockImplementation(async () => ({ messages: [...rows], totalCount: rows.length }));
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
            await vi.waitFor(() => expect(completion).toHaveBeenCalledOnce());
            const requestBody = JSON.parse(String(completion.mock.calls[0][1]?.body));
            expect(requestBody.max_tokens).toBe(250_000);
            const payload = requestBody.messages as StoryApiMessage[];
            expect(payload).toContainEqual({ role: 'assistant', content: '[第 12 楼 · 最近一段剧场正文]\n楼层内容 12' });
            const readsOriginal = mode === '已撤销向量';
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
            expect(payload.filter(message => message.content.includes(vectorText))).toHaveLength((mode === '独立向量' || mode === '向量超预算') ? 1 : 0);
            expect(payload.some(message => message.content.includes('这一段还未发生'))).toBe(false);
            if (mode === '增量事实' || textFallback) {
                expect(payload.at(-3)).toMatchObject({ role: 'system', content: expect.stringContaining('[第 11 楼] 钥匙现在由小雨保管。') });
                expect(payload.some(message => message.content.includes('林星保管钥匙。'))).toBe(true);
                expect(payload.some(message => message.content.includes('### 剧情经过（按楼层先后；以下为已被更新的旧状态）')
                    && message.content.includes('[第 1 楼] 林星保管钥匙。'))).toBe(true);
                expect(payload.some(message => message.content.includes('### 本剧情目前已确认的状态（按楼层先后排列）')
                    && message.content.includes('[第 11 楼] 钥匙现在由小雨保管。'))).toBe(true);
            }
            if (evidence) {
                const excerpt = payload.find(message => message.content.startsWith('### 相关剧情原文摘录'));
                expect(excerpt).toMatchObject({role: 'system', content: expect.stringContaining('[第 8 楼] 交接完成，回执编号是 74851。')});
                expect(payload.filter(message => message.content.includes('74851'))).toHaveLength(1);
            }
            expect(payload.at(-2)?.content).toBe('侧门通向庭院。');
            expect(payload.at(-1)).toEqual({ role: 'user', content: '[第 13 楼 · 本轮用户推进]\n' + rows[12].content });
            await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
            expect(save.mock.calls[0][0]).toMatchObject({ role: 'assistant', metadata: { theaterReplyToUserId: 136 } });
        } finally {
            await act(async () => root.unmount());
            container.remove();
            Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
            vi.restoreAllMocks();
            vi.unstubAllGlobals();
        }
    });
    it('player simulation: real continue button injects one current state, ordered historical changes and one worldbook without duplicates', async () => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
        const entry = {
            ...createStoryTheaterDraft(1), title: '钟楼的铜钥匙',
            characterIds: ['actor'], selectedWorldbookIds: ['side-door'],
            archiveAfter: 2, archiveKeepRecent: 1, forceUserLastMessage: true,
            automaticMemoryApiEnabled: false, // Even with archive threshold passed, no automatic extraction/API call.
        };
        const preset = createBlankStoryPreset('不含世界书与历史插槽的自定义预设', 1);
        preset.document.prompts = [];
        const charId = storyTheaterThreadId(entry.id);
        const rows: Message[] = Array.from({ length: 31 }, (_, i) => ({
            id: 500 + 3 * i, charId, type: 'text',
            role: i % 2 === 0 ? 'user' : 'assistant',
            content: i === 30 ? '第二天清晨，我要拿铜钥匙打开侧门。' : '已有剧情楼层 ' + (i + 1),
            timestamp: 9000 - i,
            metadata: { source: 'story_theater', theaterId: entry.id, theaterArchived: i < 24 },
        }));
        const base = { key: '铜钥匙/持有人', kind: 'fact' as const, terms: ['铜钥匙'] };
        entry.archives = [
            { id: 'old', strategy: 'summary', fromMessageId: rows[0].id, toMessageId: rows[11].id,
                createdAt: 1, messageCount: 12,
                facts: [
                    { key: '侧门/出口', kind: 'fact' as const, text: '侧门通向庭院。',
                        terms: ['侧门'], sourceMessageId: rows[0].id },
                    { ...base, text: '林星保管铜钥匙。', sourceMessageId: rows[5].id },
                ],
                summary: '不能重复注入的结构化旧摘要：林星保管铜钥匙。',
            },
            { id: 'new', strategy: 'summary', fromMessageId: rows[12].id, toMessageId: rows[23].id,
                createdAt: 2, messageCount: 12,
                historyFacts: [{ ...base, text: '阿泽曾暂时保管铜钥匙。',
                    storyTime: '第一天傍晚', sourceMessageId: rows[13].id }],
                facts: [
                    { ...base, text: '铜钥匙现在由小雨保管。', storyTime: '第二天清晨',
                        sourceMessageId: rows[15].id },
                    { key: '作者/执笔', kind: 'author' as const, terms: ['小雨'],
                        text: '后续不得替小雨擅自决定重大行动。', sourceMessageId: rows[20].id },
                    { key: '钟楼/地图传言', kind: 'fact' as const, modality: 'unverified' as const,
                        terms: ['钟楼'], text: '据说钟楼地下有地图，但无人证实。', sourceMessageId: rows[17].id },
                    { key: '侧门/探查计划', kind: 'fact' as const, modality: 'planned' as const,
                        terms: ['侧门'], text: '林星打算以后再检查侧门。', sourceMessageId: rows[19].id },
                ],
                summary: '不能重复注入的结构化新摘要：铜钥匙现在由小雨保管。',
            },
        ];
        vi.spyOn(DB, 'getRecentMessagesWithCount').mockImplementation(async () => ({ messages: [...rows], totalCount: rows.length }));
        vi.spyOn(DB, 'getMessagesByCharId').mockImplementation(async () => [...rows].reverse());
        const save = vi.spyOn(DB, 'saveStoryTheaterTurn').mockImplementation(async row => {
            rows.push({ ...row, id: 990 });
            return 990;
        });
        const completion = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
            choices: [{ message: { content: '小雨握紧了钥匙，侧门仍在前方。' } }],
        })));
        vi.stubGlobal('fetch', completion);
        const container = document.createElement('div');
        document.body.append(container);
        const root = createRoot(container);
        try {
            await act(async () => root.render(React.createElement(StoryTheaterSession, {
                entry, preset, masks: [], onBack: vi.fn(), onEdit: vi.fn(),
                onEntryChange: vi.fn(), onArchiveCommitted: vi.fn(),
            })));
            const retry = container.querySelector<HTMLButtonElement>('button[title="继续上次中断"]');
            expect(retry).toBeTruthy();
            await act(async () => retry!.click());
            await vi.waitFor(() => expect(completion).toHaveBeenCalledOnce());
            const payload = JSON.parse(String(completion.mock.calls[0][1]?.body)).messages as StoryApiMessage[];
            const current = payload.find(item => item.content.includes('### 本剧情目前已确认的状态（按楼层先后排列）'))?.content || '';
            const history = payload.find(item => item.content.includes('### 剧情经过（按楼层先后；以下为已被更新的旧状态）'))?.content || '';
            expect(current).toContain('[第 16 楼 · 剧情时间：第二天清晨] 铜钥匙现在由小雨保管。');
            expect(current).toContain('用户协助指令：后续不得替小雨擅自决定重大行动。');
            expect(current).toContain('【尚未核实的说法】据说钟楼地下有地图，但无人证实。');
            expect(current).toContain('【尚未发生的计划】林星打算以后再检查侧门。');
            expect(current).not.toContain('林星保管铜钥匙。');
            expect(current).not.toContain('侧门通向庭院。'); // Already included in selected worldbook
            expect(history).toContain('[第 6 楼] 林星保管铜钥匙。');
            expect(history).toContain('[第 14 楼 · 剧情时间：第一天傍晚] 阿泽曾暂时保管铜钥匙。');
            expect(history.indexOf('林星保管铜钥匙。')).toBeLessThan(history.indexOf('阿泽曾暂时保管铜钥匙。'));
            expect(payload.filter(item => item.content.includes('侧门通向庭院。'))).toHaveLength(1);
            expect(payload.some(item => item.content.includes('不能重复注入的结构化旧摘要'))).toBe(false);
            expect(payload.some(item => item.content.includes('不能重复注入的结构化新摘要'))).toBe(false);
            expect(payload.at(-1)?.content).toContain('[第 31 楼 · 本轮用户推进]');
            await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
            expect(completion).toHaveBeenCalledTimes(1); // No extra archive/API call on a disabled switch
        } finally {
            await act(async () => root.unmount());
            container.remove();
            Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
            vi.restoreAllMocks();
            vi.unstubAllGlobals();
        }
    });

});
