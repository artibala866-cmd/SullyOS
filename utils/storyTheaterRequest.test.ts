// @vitest-environment jsdom
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, expect, it, vi } from 'vitest';
import StoryTheaterSession from '../components/date/story/StoryTheaterSession';
import type { Message } from '../types';
import { DB } from './db';
import { MemoryNodeDB } from './memoryPalace/db';
import { readStoryRecallReceipt } from './storyTheaterRecall';
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
            if (textFallback) {
                const timeline = payload.at(-3)?.content ?? '';
                expect(timeline).toContain('### 剧情记忆时间线（按原剧情楼层排列）');
                expect(timeline).toContain('[第 1 楼] 【旧状态】林星保管钥匙。');
                expect(timeline).toContain('[第 11 楼] 【已发生】钥匙现在由小雨保管。');
                expect(timeline.indexOf('[第 1 楼]')).toBeLessThan(timeline.indexOf('[第 11 楼]'));
            }
            if (mode === '增量事实') {
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
    it.each(['summary', 'vector'] as const)('%s: continues with ordered memories and one worldbook without duplicate summaries', async strategy => {
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
        const vector = strategy === 'vector';
        const archivedCount = vector ? 49 : 24;
        const firstBatchCount = vector ? 21 : 12;
        const pending = vector ? 49 : 30;
        const rows: Message[] = Array.from({ length: pending + 1 }, (_, i) => ({
            id: 500 + 3 * i, charId, type: 'text',
            role: i === pending || i % 2 === 0 && i !== pending - 1 ? 'user' : 'assistant',
            content: i === pending ? (vector ? '我要拿铜钥匙打开侧门。' : '第二天清晨，我要拿铜钥匙打开侧门。') : '已有剧情楼层 ' + (i + 1),
            timestamp: 9000 - i,
            metadata: { source: 'story_theater', theaterId: entry.id, theaterArchived: i < archivedCount },
        }));
        const base = { key: '铜钥匙/持有人', kind: 'fact' as const, terms: ['铜钥匙'] };
        entry.archives = [
            { id: 'old', strategy, fromMessageId: rows[0].id, toMessageId: rows[firstBatchCount - 1].id,
                createdAt: vector ? 2 : 1, messageCount: firstBatchCount,
                facts: [
                    { key: '侧门/出口', kind: 'fact' as const, text: '侧门通向庭院。',
                        terms: ['侧门'], sourceMessageId: rows[0].id },
                    { ...base, text: '林星保管铜钥匙。', sourceMessageId: rows[5].id },
                ],
                summary: '不能重复注入的结构化旧摘要：林星保管铜钥匙。',
            },
            { id: 'new', strategy, fromMessageId: rows[firstBatchCount].id, toMessageId: rows[archivedCount - 1].id,
                createdAt: vector ? 1 : 2, messageCount: archivedCount - firstBatchCount,
                historyFacts: [{ ...base, text: '阿泽曾暂时保管铜钥匙。',
                    ...(!vector ? {storyTime:'第一天傍晚'} : {}), sourceMessageId: rows[vector ? 23 : 13].id }],
                facts: [
                    { ...base, text: '铜钥匙现在由小雨保管。', ...(!vector ? {storyTime:'第二天清晨'} : {}),
                        sourceMessageId: rows[vector ? 36 : 15].id },
                    { key: '作者/执笔', kind: 'author' as const, terms: ['小雨'],
                        text: '后续不得替小雨擅自决定重大行动。', sourceMessageId: rows[vector ? 42 : 20].id },
                    { key: '钟楼/地图传言', kind: 'fact' as const, modality: 'unverified' as const,
                        terms: ['钟楼'], text: '据说钟楼地下有地图，但无人证实。', sourceMessageId: rows[vector ? 24 : 17].id },
                    { key: '侧门/探查计划', kind: 'fact' as const, modality: 'planned' as const,
                        terms: ['侧门'], text: '林星打算以后再检查侧门。', sourceMessageId: rows[vector ? 23 : 19].id },
                ],
                summary: '不能重复注入的结构化新摘要：铜钥匙现在由小雨保管。',
            },
        ];
        if (vector) {
            entry.archives[0].facts!.push({
                key:'侧门/门栓',kind:'fact',text:'侧门的门栓已经松开。',terms:['侧门'],sourceMessageId:rows[12].id,
            });
            entry.archives[0].facts!.push({
                key:'侧门/清点',kind:'fact',modality:'planned',text:'计划清点侧门备件。',terms:['侧门'],sourceMessageId:rows[9].id,
            });
            entry.archives.reverse();
            for (const box of entry.archives) {
                box.vectorMemoryIds = [];
                for (const [index, fact] of box.facts!.entries()) {
                    const id = entry.id + '-' + box.id + '-' + index;
                    fact.vectorNodeId = id;
                    fact.vectorTextState = 'synced';
                    box.vectorMemoryIds.push(id);
                    await MemoryNodeDB.save({ id, charId, content:fact.text, room:'living_room', tags:fact.terms,
                        mood:'neutral',embedded:true,createdAt:1,lastAccessedAt:1,accessCount:0,importance:6 });
                }
            }
            await DB.saveStoryTheater(entry);
        }
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
            if (vector) {
                const timeline = payload.find(item => item.content.startsWith('### 剧情记忆时间线'))?.content || '';
                expect(timeline.split('\n').filter(line => line.startsWith('[第 '))).toEqual([
                    '[第 6 楼] 【旧状态】林星保管铜钥匙。',
                    '[第 10 楼] 【尚未发生的计划】计划清点侧门备件。',
                    '[第 13 楼] 【已发生】侧门的门栓已经松开。',
                    '[第 24 楼] 【尚未发生的计划】林星打算以后再检查侧门。',
                    '[第 24 楼] 【旧状态】阿泽曾暂时保管铜钥匙。',
                    '[第 25 楼] 【尚未核实的说法】据说钟楼地下有地图，但无人证实。',
                    '[第 37 楼] 【已发生】铜钥匙现在由小雨保管。',
                    '[第 43 楼] 用户协助指令：后续不得替小雨擅自决定重大行动。',
                ]);
                expect(timeline).not.toContain('剧情时间：');
                expect(timeline).toContain('同楼事件的先后以原文为准');
                expect(payload.some(item => item.content.startsWith('### 本剧情目前已确认的状态'))).toBe(false);
                expect(payload.some(item => item.content.startsWith('### 剧情经过'))).toBe(false);
                expect((await DB.getStoryTheaters()).find(item => item.id === entry.id)?.archives).toEqual(entry.archives);
            } else {
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
            }
            expect(payload.filter(item => item.content.includes('侧门通向庭院。'))).toHaveLength(1);
            expect(payload.some(item => item.content.includes('不能重复注入的结构化旧摘要'))).toBe(false);
            expect(payload.some(item => item.content.includes('不能重复注入的结构化新摘要'))).toBe(false);
            expect(payload.at(-1)?.content).toContain(`[第 ${pending + 1} 楼 · 本轮用户推进]`);
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

    it.each([
        { model: 'fixture-prose-a', strategy: 'vector', source: 'vectors' },
        { model: 'fixture-prose-b', strategy: 'vector', source: 'sync-copy' },
        { model: 'fixture-prose-c', strategy: 'summary', source: 'archived-original' },
    ] as const)('$model: carries rules and settled tasks with history disabled ($source)', async ({ model, strategy, source }) => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
        const prevModel = state.apiConfig.model;
        state.apiConfig.model = model;
        const entry = {
            ...createStoryTheaterDraft(1), title: '旧城的亡魂', characterIds: ['actor'],
            forceUserLastMessage: true, automaticMemoryApiEnabled: false,
            // This case exercises a small budget explicitly; the long-story
            // default is independently configurable and must not be reduced.
            archiveRecallMaxChars: 4000,
        };
        const preset = createBlankStoryPreset('只读归档', 1);
        preset.document.prompts = [{ id: 'disabled-history', name: '旧正文', role: 'system', marker: 'history', enabled: false, content: '' }];
        const charId = storyTheaterThreadId(entry.id);
        const rule = '主角是已经死去的鬼魂，普通人看不见他，也听不见他的声音。';
        const plan = '小雨打算给王姨送橘子和换门锁。';
        const oranges = '橘子已经送到王姨手里。';
        const lock = '小雨已经把门锁换好了。';
        const rows: Message[] = Array.from({ length: 121 }, (_, index) => ({
            id: index + 1, charId, type: 'text', role: index % 2 ? 'assistant' : 'user',
            content: index === 1 ? rule : index === 3 ? plan : index === 7 ? oranges : index === 9 ? lock
                : index === 120 ? '接着写他走到街口，注意之前已经确定的状态。'
                : '不可整楼发送的正文 ' + index,
            timestamp: index,
            metadata: { source: 'story_theater', theaterId: entry.id, theaterArchived: index < 118 },
        }));
        const fact = (key: string, text: string, sourceMessageId: number, terms: string[] = []) => ({
            key, text, sourceMessageId, terms, kind: 'fact' as const,
        });
        entry.archives = [
            { id: 'first', strategy, fromMessageId: 1, toMessageId: 6, messageCount: 6, createdAt: 9,
                facts: [
                    ...(source === 'archived-original' ? [] : [fact('主角/身份', rule, 2)]),
                    { ...fact('王姨/拜访事项', plan, 4, ['王姨', '橘子', '门锁']), modality: 'planned' as const },
                    { ...fact('邻居/送橘子', '小雨打算给李姨送橘子。', 5, ['李姨']), modality: 'planned' as const },
                    { ...fact('王姨/另一次送橘子', '小雨打算明天再给王姨送橘子。', 5), storyTime: '明天', modality: 'planned' as const },
                ] },
            { id: 'second', strategy, fromMessageId: 7, toMessageId: 118, messageCount: 112, createdAt: 2,
                facts: [
                    ...(source === 'archived-original' ? [] : [
                        fact('王姨/橘子交接', oranges, 8, ['王姨', '橘子']),
                        fact('王姨/门锁更新', lock, 10, ['王姨', '门锁']),
                    ]),
                    ...Array.from({ length: 95 }, (_, i) => fact('城区/记录' + i,
                        '当天街巷中有一块墙砖留着编号和刻字，巡查员登记它的位置。墙砖颜色与摆放位置各有不同。记录号' + i, i + 11)),
                ] },
        ];
        if (strategy === 'vector') for (const box of entry.archives) {
            box.vectorMemoryIds = [];
            box.facts = box.facts!.map((item, index) => {
                const id = entry.id + '-' + box.id + '-' + index;
                box.vectorMemoryIds!.push(id);
                return { ...item, vectorNodeId: id, vectorTextState: 'synced' };
            });
            if (source === 'vectors') for (const item of box.facts) {
                await MemoryNodeDB.save({ id: item.vectorNodeId!, charId, content: item.text, room: 'living_room',
                    tags: item.terms, mood: 'neutral', embedded: false, createdAt: 1, lastAccessedAt: 1, accessCount: 0, importance: 6 });
            }
        }
        await DB.saveStoryTheater(entry);
        if (source !== 'archived-original') {
            // No ghost or outcome original exists in this request fixture;
            // the corresponding facts must come from stored archive memory.
            for (const i of [1, 7, 9]) rows[i].content = '不提供归档前的正文。';
        }
        vi.spyOn(DB, 'getRecentMessagesWithCount').mockImplementation(async () => ({ messages: [...rows], totalCount: rows.length }));
        vi.spyOn(DB, 'getMessagesByCharId').mockImplementation(async () => [...rows]);
        const save = vi.spyOn(DB, 'saveStoryTheaterTurn').mockResolvedValue(122);
        const completion = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
            choices: [{ message: { content: '车从街口过去，司机的目光没有在他身上停留。' } }],
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
            await act(async () => { retry!.click(); });
            await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
            expect(completion).toHaveBeenCalledOnce();
            const request = JSON.parse(String(completion.mock.calls[0][1]?.body));
            expect(request.model).toBe(model);
            const payload = request.messages as StoryApiMessage[];
            const archiveText = payload.find(item => item.content.includes('当前持续生效的剧情设定】'))?.content ?? '';
            expect(archiveText).toContain(rule);
            expect(archiveText).toContain('【已完成】' + oranges);
            expect(archiveText).toContain('【已完成】' + lock);
            expect(archiveText).toContain('小雨打算给李姨送橘子。');
            expect(archiveText).toContain('小雨打算明天再给王姨送橘子。');
            expect(archiveText).not.toContain(plan);
            expect(archiveText.length).toBeLessThan(4750);
            expect(payload.flatMap(item => item.content.match(/普通人看不见他/gu) ?? [])).toHaveLength(1);
            expect(payload.some(item => item.content.includes('不可整楼发送的正文'))).toBe(false);
            expect(payload.at(-1)?.role).toBe('user');
        } finally {
            await act(async () => root.unmount());
            state.apiConfig.model = prevModel;
            container.remove();
            Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
            vi.restoreAllMocks();
            vi.unstubAllGlobals();
        }
    });

    it.each([false, true])('直接继续从手动旧档承接，世界书实际发送状态才参与去重（%s）', async activated => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
        const entry = {
            ...createStoryTheaterDraft(1), title: '钟楼等候', characterIds: ['actor'], selectedWorldbookIds: ['side-door'],
            forceUserLastMessage: true, automaticMemoryApiEnabled: false,
        };
        const charId = storyTheaterThreadId(entry.id);
        const preset = createBlankStoryPreset('剧情归档接续');
        preset.document.prompts.find(prompt => prompt.marker === 'history')!.enabled = false;
        // A constant book is transmitted even though the continuation contains no keyword.
        const originalBook = { ...state.worldbooks[0] };
        state.worldbooks[0].constant = activated;
        const data = [
            ['钟楼的旧石梯通向雾门。', '雾门/路径', ['雾门']],
            ['侧门通向庭院。', '侧门/路径', ['侧门']],
            ['林星正在钟楼等候小雨。', '钟楼/当前场景', ['林星', '钟楼']],
            ['林星计划等小雨到了再查石梯。', '钟楼/待办', ['林星', '石梯']],
        ] as const;
        const rows: Message[] = data.map((_, index) => ({
            id: (index + 1) * 100, charId, role: 'assistant', type: 'text', timestamp: index,
            content: 'ARCHIVED_ORIGINAL_' + index, metadata: { source: 'story_theater', theaterArchived: true },
        }));
        rows.push({ id: 500, charId, role: 'assistant', type: 'text', timestamp: 500,
            content: '林星走进渡口候船厅。UNARCHIVED_PRIVATE_SENTENCE。', metadata: { source: 'story_theater' } });
        entry.archives = [{
            id: 'manual-summary', strategy: 'summary', fromMessageId: 100, toMessageId: 400, messageCount: 4, createdAt: 1,
            facts: data.map(([text, key, terms], index) => ({
                key, kind: 'fact' as const, text, terms: [...terms], sourceMessageId: rows[index].id,
            })),
        }];
        await DB.saveStoryTheater(entry);
        vi.spyOn(DB, 'getRecentMessagesWithCount').mockResolvedValue({ messages: rows, totalCount: rows.length });
        vi.spyOn(DB, 'getMessagesByCharId').mockResolvedValue(rows);
        vi.spyOn(DB, 'saveStoryTheaterTurn').mockResolvedValue(600);
        const completion = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
            choices: [{ message: { content: '候船厅响起了脚步声。' }, finish_reason: 'stop' }],
        }));
        vi.stubGlobal('fetch', completion);
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        try {
            await act(async () => root.render(React.createElement(StoryTheaterSession, {
                entry, preset, masks: [], onBack: vi.fn(), onEdit: vi.fn(), onEntryChange: vi.fn(), onArchiveCommitted: vi.fn(),
            })));
            const button = host.querySelector<HTMLButtonElement>('button[aria-label="继续当前剧情"]');
            expect(button).toBeTruthy();
            await act(async () => button!.click());
            await vi.waitFor(() => expect(completion).toHaveBeenCalledOnce());
            const messages = JSON.parse(String(completion.mock.calls[0][1]?.body)).messages as StoryApiMessage[];
            const text = messages.map(message => message.content).join('\n');
            expect(text.match(/侧门通向庭院。/gu)).toHaveLength(1);
            expect(text).toContain('【最近归档的场景与后续事项】');
            expect(text).toContain('[第 5 楼] 林星 · 走进渡口候船厅');
            expect(text).toContain('林星计划等小雨到了再查石梯。');
            expect(text).not.toMatch(/ARCHIVED_ORIGINAL|UNARCHIVED_PRIVATE_SENTENCE/);
            expect(readStoryRecallReceipt(entry.id)).toMatchObject({ availableFacts: 4, embeddingRequests: 0,
                injectedFloors: expect.arrayContaining([3, 4, 5]) });
            expect(messages.at(-1)?.role).toBe('user');
        } finally {
            state.worldbooks[0] = originalBook;
            await act(async () => root.unmount());
            host.remove();
            Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
            vi.restoreAllMocks();
            vi.unstubAllGlobals();
        }
    });

});
