import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message, StoryTheaterEntry } from '../types';
import { DB } from './db';
import { MemoryNodeDB, MemoryVectorDB } from './memoryPalace/db';
import { loadStoryVectorRecall, selectStoryVectorRecall } from './storyTheaterVectorMemory';
import { createStoryTheaterDraft, selectStoryArchiveBatch, storyTheaterThreadId } from './storyTheater';
import { archiveStoryFloorRange, generateStoryArchiveSummary, parseStoryArchiveSummary, regenerateStoryArchiveSummary, revokeStoryArchive } from './storyTheaterArchive';

const api = { baseUrl: 'https://llm.invalid/v1/', apiKey: 'test', model: 'test' };
const completion = (content: unknown, finish_reason = 'stop', reasoning_content = '思考过程') => ({ choices: [{ finish_reason, message: { content, reasoning_content } }] });
const sections = ['关键事件与因果', '时间地点与场景', '人物关系与转折', '好感与心理变化', '新增设定与细节', '未解决事项与续写落点'];
// Test completions contain enough independent story facts to meet the real 100-character saved-box minimum.
const fixtureFacts = '；补充已确认的剧情背景：小雨与阿泽在雨夜车站一起等待雨停，双方互相认识；阿泽明确答应陪小雨走回家，但还没有确认出发时间。站台外仍有积水，二人尚未离开车站，也没有发生其他已明确完成的行动。';
const savedSummary = (text: string) => sections.map((heading, index) =>
    '【' + heading + '】\n' + (index === 0 ? text + fixtureFacts : '原文未交代'),
).join('\n\n');
const structured = (text: string, details: Record<string, string> = {}) => completion(sections.map((section, index) =>
    '【' + section + '】\n' + (index === 0 ? (details[section] ?? text) + fixtureFacts : (details[section] ?? '原文未交代')),
).join('\n\n'));
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
let entry: StoryTheaterEntry, messages: Message[], serial = 0;
const fetchMock = vi.fn();
const fresh = async () => (await DB.getStoryTheaters()).find(item => item.id === entry.id)!;
const regenerate = () => regenerateStoryArchiveSummary(entry.id, 'box', api);

beforeEach(async () => {
    serial++;
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset().mockResolvedValue(response(structured('两人在车站等雨停，一起走回家。')));
    entry = { ...createStoryTheaterDraft(), id: `archive-qa-${serial}`, title: '雨夜车站', writesToCharacterMemory: false };
    messages = [];
    for (const [role, content] of [['user', '我们先在车站等雨停。'], ['assistant', '<think>先计划情节</think>阿泽答应陪小雨走回家。']] as const) {
        const row = { charId: storyTheaterThreadId(entry.id), role, type: 'text' as const, content, timestamp: 10, metadata: { source: 'story_theater', theaterId: entry.id, theaterArchived: true } };
        messages.push({ ...row, id: await DB.saveMessage(row) });
    }
    entry.archives = [{ id: 'box', strategy: 'summary', fromMessageId: messages[0].id, toMessageId: messages[1].id, messageCount: 2, summary: '旧摘要里只有思考过程', createdAt: 10,
        memoryConversions: { actor: { date: '2026-10-01', convertedAt: 12, destination: 'neural', memoryIds: ['kept'], skipped: 0 } } }];
    await DB.saveStoryTheater(entry);
});
afterEach(() => vi.unstubAllGlobals());

describe('story summary final channel', () => {
    it('strips inline thinking and ignores native or typed reasoning, while retaining final text', () => {
        expect(parseStoryArchiveSummary(completion('<thinking>计划</thinking>回家途中他们约定下周再见。'))).toBe('回家途中他们约定下周再见。');
        expect(parseStoryArchiveSummary(completion([{ type: 'thinking', text: '计划' }, { type: 'text', text: '正文' }]))).toBe('正文');
        for (const content of ['', null, '<think>只有推理</think>', '<thought>未闭合推理', [{ type: 'reasoning', text: '只有推理' }]]) {
            expect(() => parseStoryArchiveSummary(completion(content))).toThrow('没有返回事件盒正文');
        }
    });
    it('rejects incomplete, filtered and recognizable untagged reasoning instead of overwriting summaries', () => {
        expect(() => parseStoryArchiveSummary(completion('部分摘要', 'length'))).toThrow('上限');
        expect(() => parseStoryArchiveSummary(completion('摘要', 'content_filter'))).toThrow('拦截');
        expect(() => parseStoryArchiveSummary({ ...completion('只写到一半'), __sullyRawStreamTerminal: false })).toThrow('原正文未归档');
        expect(() => parseStoryArchiveSummary(completion('Paragraph 1: 31 chars\nStill too long'))).toThrow('推理过程');
        expect(parseStoryArchiveSummary(completion('他说「Let’s count together」，两人一起数星星。'))).toContain('数星星');
    });
    it('does not send legacy Tavern title/desc header comments when summarizing an old opening', async () => {
        const taggedOpening = {
            ...messages[1],
            content: '<!-- title:第一幕 -->\n<!-- desc:雨夜。 -->\n{{char}}走进车站。',
            metadata: {
                ...messages[1].metadata,
                theaterOpeningGreeting: { characterId: 'actor', greetingId: 'legacy-opening' },
            },
        } as Message;
        await generateStoryArchiveSummary(entry.title, [taggedOpening, messages[0]], api);
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.messages[1].content).toContain('{{char}}走进车站');
        expect(body.messages[1].content).not.toContain('<!-- title:');
        expect(body.messages[1].content).not.toContain('<!-- desc:');
        expect(taggedOpening.content).toContain('<!-- title:'); // source remains intact
    });

    it('rejects overlong cheap-model summaries instead of hiding original floors and poisoning every later main prompt', async () => {
        fetchMock.mockResolvedValueOnce(response(completion('长'.repeat(1501))));
        await expect(generateStoryArchiveSummary(entry.title, messages, api)).rejects.toThrow('返回了 1501 字符，超过 1500 字符的上限');
        expect(parseStoryArchiveSummary(completion('长'.repeat(1500)))).toHaveLength(1500);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect((await fresh()).archives[0].summary).toBe('旧摘要里只有思考过程');
        expect((await DB.getMessagesByCharId(storyTheaterThreadId(entry.id), true)).slice(0, 2)).toEqual(messages);
    });
    it('rejects a too-short final event box rather than archiving the original floors', async () => {
        const tooShort = sections.map((heading, index) => '【' + heading + '】\n' + (index === 0 ? '嗯' : '原文未交代')).join('\n\n');
        fetchMock.mockResolvedValueOnce(response(completion(tooShort)));
        await expect(generateStoryArchiveSummary(entry.title, messages, api)).rejects.toThrow('必须在 100～1500 字符之间');
        expect((await fresh()).archives[0].summary).toBe('旧摘要里只有思考过程');
        expect((await DB.getMessagesByCharId(storyTheaterThreadId(entry.id), true)).slice(0, 2)).toEqual(messages);
    });

    it('persists the original six headings even when a category is unknown', async () => {
        const summary = await generateStoryArchiveSummary(entry.title, messages, api);
        expect(summary.match(/【[^】]+】/g)).toEqual(sections.map(heading => '【' + heading + '】'));
        expect(summary).toContain('【人物关系与转折】\n原文未交代');
        expect(summary).toContain('【未解决事项与续写落点】\n原文未交代');
        expect(Array.from(summary).length).toBeGreaterThanOrEqual(100);
    });

    it('checks the complete saved box including appended UI affinity, not only the model output', async () => {
        const source = [{ ...messages[0], metadata: { ...messages[0].metadata,
            theaterAffinityInputs: [{ characterName: '阿泽', delta: 3, reason: '补充'.repeat(80), awareness: 'noticed' }],
        } }, messages[1]];
        fetchMock.mockResolvedValueOnce(response(completion(sections.map((heading, index) =>
            '【' + heading + '】\n' + (index === 0 ? '长'.repeat(1320) : '原文未交代'),
        ).join('\n\n'))));
        await expect(generateStoryArchiveSummary(entry.title, source, api)).rejects.toThrow('必须在 100～1500 字符之间（含好感记录）');
        expect((await fresh()).archives[0].summary).toBe('旧摘要里只有思考过程');
    });

    it('rejects impossible affinity receipts before spending an API call', async () => {
        const input = { ...messages[0], metadata: { ...messages[0].metadata,
            theaterAffinityInputs: Array.from({ length: 10 }, (_, i) => ({
                characterName: '演员' + i, delta: 1, reason: '无法容纳的备注'.repeat(25), awareness: 'noticed',
            })),
        } };
        await expect(generateStoryArchiveSummary(entry.title, [input, messages[1]], api))
            .rejects.toThrow('本批界面好感记录过长');
        expect(fetchMock).not.toHaveBeenCalled();
        expect((await fresh()).archives[0].summary).toBe('旧摘要里只有思考过程');
    });

    it('keeps author corrections in the existing sixth section rather than inventing another section', async () => {
        fetchMock.mockResolvedValueOnce(response(structured('小雨与阿泽仍在车站等雨停。', {
            未解决事项与续写落点: '仍需确认是否离开；用户协助指令：禁止替小雨做重大选择。',
        })));
        const text = await generateStoryArchiveSummary(entry.title, [
            { ...messages[0], content: '（纠正：你不要擅自替小雨决定离开）' }, messages[1],
        ], api);
        expect(text).toContain('【未解决事项与续写落点】\n仍需确认是否离开；用户协助指令：禁止替小雨做重大选择。');
        expect(text.match(/【[^】]+】/g)).toHaveLength(6);
        expect(Array.from(text).length).toBeGreaterThanOrEqual(100);
        expect(Array.from(text).length).toBeLessThanOrEqual(1500);
        const system = JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content;
        expect(system).toContain('不得将角色台词、故事内的请求、普通剧情推进误当成用户对AI的协助指令');
    });

    it('keeps scene transitions, supporting relationships, custom settings and exact UI affinity in one request', async () => {
        const content = '周五 21:10，车站站台：小雨、阿泽和阿祁在场。次日清晨转到旅馆。阿祁是阿泽的姐姐。小雨左眼怕强光。';
        const source = [{ ...messages[0], content, metadata: { theaterAffinityInputs: [
            { characterName: '阿泽', delta: 17, reason: '守住秘密', awareness: 'unnoticed' },
            { characterName: '阿祁', delta: -3, reason: '隐瞒约定', awareness: 'noticed' },
        ] } }, messages[1]];
        fetchMock.mockResolvedValueOnce(response(structured('阿泽答应陪小雨回去。', {
            时间地点与场景: '周五 21:10 车站站台 → 次日清晨旅馆。',
            人物关系与转折: '阿祁是阿泽的姐姐。',
            新增设定与细节: '小雨左眼怕强光。',
        })));
        const summary = await generateStoryArchiveSummary(entry.title, source, api, { firstFloor: 5 });
        expect(summary).toContain('周五 21:10 车站站台 → 次日清晨旅馆');
        expect(summary).toContain('阿祁是阿泽的姐姐');
        expect(summary).toContain('小雨左眼怕强光');
        expect(summary).toContain('第 5 楼 · 阿泽 · 用户对角色 · +17 · 未告知角色 · 原因：守住秘密');
        expect(summary).toContain('第 5 楼 · 阿祁 · 用户对角色 · -3 · 允许察觉 · 原因：隐瞒约定');
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content).toContain('界面好感记录：');
        const prompt = JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content as string;
        expect(prompt).toContain('本批界面好感记录将在保存时额外占用');
        expect(prompt).toContain('不要重复抄写好感记录');
        expect(Array.from(summary).length).toBeLessThanOrEqual(1500);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('accepts terse causal shorthand and keeps distinct knowledge without saving the last-scene snapshot', async () => {
        fetchMock.mockResolvedValueOnce(response(structured('阿泽交备用钥匙→小雨接管店；小雨感到身旁冷气，猜测阿泽在场。', {
            时间地点与场景: '当日正午从政务中心转至水果店。',
            人物关系与转折: '阿泽=小雨兄长；小雨未证实鬼魂身份。',
            好感与心理变化: '阿泽：担忧小雨受冻→主动退开。',
            新增设定与细节: '鬼魂不能碰实物；狗能察觉鬼魂。',
            未解决事项与续写落点: '老王发货未到；店铺进货待处理。',
        })));
        const summary = await generateStoryArchiveSummary(entry.title, messages, api);
        expect(summary).toContain('阿泽交备用钥匙→小雨接管店');
        expect(summary).toContain('小雨未证实鬼魂身份');
        expect(summary).toContain('老王发货未到');
        expect(summary.match(/【[^】]+】/g)).toHaveLength(6);
    });

    it('keeps ambiguous lookalike names, tentative sensing, failed actions and delivery status in the actual source prompt', async () => {
        const ambiguous: Message[] = [
            { ...messages[0], content: '幸芳白是已故哥哥（魂魄）；妹妹幸福哭着求哥哥带走自己，但本人仍活着。' },
            { ...messages[1], content: '幸福凭宠物反应和冷气认定哥哥在旁，但看不到魂魄。幸芳白试图用智能音箱开暖气失败。顾北成联系老王送货，货尚未到；平措刚骑车到店门口。' },
        ];
        await generateStoryArchiveSummary(entry.title, ambiguous, api);
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        const system: string = body.messages[0].content;
        const source: string = body.messages[1].content;
        for (const rule of ['人物的愿望、请求、计划', '角色A知道的事≠角色B也知道', '失败的尝试不能写成成功', '不记录末尾场景、最后动作或下一幕开场位置']) {
            expect(system).toContain(rule);
        }
        expect(system).not.toContain('幸芳白');
        expect(system).not.toContain('幸福');
        expect(source).toContain('妹妹幸福哭着求哥哥带走自己，但本人仍活着');
        expect(source).toContain('货尚未到；平措刚骑车到店门口');
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('rejects a missing or empty section without changing the box or retrying', async () => {
        fetchMock.mockResolvedValueOnce(response(completion('【关键事件与因果】\n两人一起回家。')));
        await expect(regenerate()).rejects.toThrow('时间地点与场景');
        fetchMock.mockResolvedValueOnce(response(structured('两人一起回家。', { 人物关系与转折: '' })));
        await expect(regenerate()).rejects.toThrow('人物关系与转折');
        expect((await fresh()).archives).toEqual(entry.archives);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('uses only Content-Type for keyless story summary endpoints (no empty Bearer header)', async () => {
        await generateStoryArchiveSummary(entry.title, messages, { ...api, apiKey: '' });
        expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json' });
    });
    it('does not retry automatically and rejects upstream errors', async () => {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: '服务不可用' } }), { status: 503 }));
        await expect(generateStoryArchiveSummary(entry.title, messages, api)).rejects.toThrow('服务不可用');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

describe('story archive regeneration', () => {
    it('regenerates with only this story\'s cheap API, without touching the expensive main provider', async () => {
        entry.memorySummaryApi = { baseUrl: 'https://cheap.invalid/v1/', apiKey: 'cheap-secret', model: 'economy-model' };
        await DB.saveStoryTheater(entry);
        const updated = await regenerate();
        const request = fetchMock.mock.calls[0];
        expect(request[0]).toBe('https://cheap.invalid/v1/chat/completions');
        expect(request[1].headers.Authorization).toBe('Bearer cheap-secret');
        expect(JSON.parse(request[1].body).model).toBe('economy-model');
        expect(request[1].__sullySkipStreamUpgrade).toBe(true);
        expect(updated.archives[0].summary).toContain('车站');
        expect(api).toEqual({ baseUrl: 'https://llm.invalid/v1/', apiKey: 'test', model: 'test' });
    });
    it('rejects a failing secondary API without retrying on the expensive main API, leaving old summary intact', async () => {
        entry.memorySummaryApi = { baseUrl: 'https://cheap.invalid/v1', apiKey: '', model: 'economy-model' };
        await DB.saveStoryTheater(entry);
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'cheap provider unavailable' } }), { status: 503 }));
        await expect(regenerate()).rejects.toThrow('cheap provider unavailable');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toContain('cheap.invalid');
        expect((await fresh()).archives[0].summary).toBe('旧摘要里只有思考过程');
    });
    it('regenerates only the exact archived source, saves in place and preserves concurrent unrelated edits/receipts', async () => {
        const { id: _id, ...newMessage } = messages[0];
        await DB.saveMessage({ ...newMessage, content: '盒外的新剧情' });
        fetchMock.mockImplementationOnce(async () => {
            await DB.saveStoryTheater({ ...entry, premise: '另一个窗口编辑的介绍', archives: [...entry.archives, { ...entry.archives[0], id: 'later' }] });
            return response(structured('新摘要'));
        });
        const result = await regenerate();
        const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(payload.messages[1].content).toContain('阿泽答应陪小雨走回家');
        expect(payload.messages[1].content).not.toContain('先计划情节');
        expect(payload.messages[1].content).not.toContain('盒外');
        expect(payload.messages[1].content).not.toContain('旧摘要');
        expect(payload).toMatchObject({ model: 'test', stream: false, max_tokens: 4096 });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(result.archives[0]).toEqual({ ...entry.archives[0], summary: savedSummary('新摘要') });
        expect(result.archives).toHaveLength(2);
        expect(result.premise).toBe('另一个窗口编辑的介绍');
        expect((await fresh()).archives[0].summary).toBe(savedSummary('新摘要'));
        expect((await DB.getMessagesByCharId(storyTheaterThreadId(entry.id), true)).slice(0, 2)).toEqual(messages);
    });
    it('keeps the old summary on reasoning-only response and unlocks for an explicit retry', async () => {
        fetchMock.mockResolvedValueOnce(response(completion('', 'stop', '只有推理')));
        await expect(regenerate()).rejects.toThrow('思维链');
        expect((await fresh()).archives[0]).toEqual(entry.archives[0]);
        await expect(regenerate()).resolves.toMatchObject({ archives: [{ summary: savedSummary('两人在车站等雨停，一起走回家。') }] });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    it('allows recovery of an empty summary but refuses incomplete source before making a request', async () => {
        entry.archives[0].summary = '';
        await DB.saveStoryTheater(entry);
        await expect(regenerate()).resolves.toBeDefined();
        await DB.deleteMessage(messages[0].id);
        await expect(regenerate()).rejects.toThrow('原文不完整');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it.each(['summary', 'message', 'delete'] as const)('rejects stale %s while the request is running', async change => {
        fetchMock.mockImplementationOnce(async () => {
            if (change === 'summary') await DB.saveStoryTheater({ ...entry, archives: [{ ...entry.archives[0], summary: '其他窗口的新摘要' }] });
            if (change === 'message') await DB.updateMessage(messages[1].id, '已编辑的原文');
            if (change === 'delete') await DB.deleteStoryTheater(entry.id);
            return response(structured('本次旧请求结果'));
        });
        await expect(regenerate()).rejects.toThrow('已变更');
        if (change !== 'delete') expect((await fresh()).archives[0].summary).toBe(change === 'summary' ? '其他窗口的新摘要' : entry.archives[0].summary);
        else expect(await fresh()).toBeUndefined();
    });
    it('guards duplicate clicks while a request is pending', async () => {
        let release!: (result: Response) => void;
        fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve; }));
        const pending = regenerate();
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        await expect(regenerate()).rejects.toThrow('正在重新总结');
        release(response(structured('新摘要')));
        await pending;
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it('preserves the saved box if the replacement cannot be written', async () => {
        const original = IDBObjectStore.prototype.put;
        const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
            if (this.name === 'story_theaters') throw new Error('磁盘写入失败');
            return original.apply(this, args);
        });
        try { await expect(regenerate()).rejects.toThrow('磁盘写入失败'); }
        finally { spy.mockRestore(); }
        expect((await fresh()).archives[0]).toEqual(entry.archives[0]);
    });
});

describe('manual event box floor selection', () => {
    const read = () => DB.getMessagesByCharId(storyTheaterThreadId(entry.id), true);
    const addFloor = async (content: string, role: Message['role'] = 'assistant') => {
        const { id: _id, ...row } = messages[1];
        const next = { ...row, role, content, metadata: { source: 'story_theater', theaterId: entry.id } };
        return { ...next, id: await DB.saveMessage(next) };
    };

    it('creates a box from just the chosen floors using the revised summary prompt', async () => {
        const third = await addFloor('他把备用钥匙留给小雨，第一次叫她搭档。');
        const fourth = await addFloor('我们约好周末见面。');
        await addFloor('范围之外的正文');
        const updated = await archiveStoryFloorRange(entry.id, [third, fourth], api);
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.messages[0].content).toContain('最终输出必须为100～1500字符');
        expect(body.messages[0].content).toContain('此范围适用于任何楼层数量');
        expect(body.messages[0].content).toContain('不按轮数套用固定字数');
        expect(body.messages[0].content).toContain('用户协助指令：具体要求');
        expect(body.messages[0].content).toContain('禁止记录本批末尾场景');
        expect(body.messages[0].content).toContain('不记录末尾场景、最后动作或下一幕开场位置');
        expect(body.messages[0].content).not.toContain('末尾单列最后场景与正在发生的动作');
        expect(body.messages[0].content).not.toMatch(/普通十轮|350—600|最多约 800/);
        expect(body.messages[0].content).toContain('信息相同只记一次');
        expect(body.messages[0].content).toContain('不能为了省字把不同人物混成');
        expect(body.messages[0].content).toContain('已请求、已联系、正在办理≠成功完成');
        expect(body.messages[0].content).toContain('旁白揭示／内心独白≠其他角色知情');
        expect(body.messages[0].content).toContain('旧事件盒由续写系统另行读取');
        expect(body.messages[0].content).toContain('不写完整叙事、对话复述、心理散文或每楼流水账');
        expect(body.messages[0].content).toContain('怀疑、感应、猜测≠亲眼确认');
        expect(body.messages[0].content).toContain('人物关系与转折');
        expect(body.messages[0].content).toContain('新增设定与细节');
        expect(body.messages[0].content).toContain('未解决事项与续写落点');
        expect(body.messages[0].content).toContain('按固定顺序写六个标题');
        expect(body.messages[1].content).toContain('第 3 楼');
        expect(body.messages[1].content).toContain('备用钥匙');
        expect(body.messages[1].content).not.toContain('范围之外');
        expect(updated.archives[1]).toMatchObject({ fromMessageId: third.id, toMessageId: fourth.id, messageCount: 2 });
        expect((await read()).slice(2).map(row => !!row.metadata?.theaterArchived)).toEqual([true, true, false]);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('automatic archiving stops before a manually archived gap', async () => {
        const rows = Array.from({ length: 10 }, (_, index): Message => ({
            ...messages[index % 2], id: index + 1,
            metadata: { ...messages[index % 2].metadata, theaterArchived: index === 2 || index === 3 },
        }));
        expect(selectStoryArchiveBatch(rows, 4, 1).map(row => row.id)).toEqual([1, 2]);
    });

    it('can archive a floor whose following reply is already in a manual box', () => {
        const rows = Array.from({ length: 10 }, (_, index): Message => ({
            ...messages[index % 2], id: index + 1,
            metadata: { ...messages[index % 2].metadata, theaterArchived: index === 1 },
        }));
        expect(selectStoryArchiveBatch(rows, 4, 1).map(row => row.id)).toEqual([1]);
    });

    it('replaces the same box, restores removed floors and preserves conversion receipts', async () => {
        const third = await addFloor('新的关系变化');
        const updated = await archiveStoryFloorRange(entry.id, [messages[1], third], api, 'box');
        expect(updated.archives).toHaveLength(1);
        expect(updated.archives[0]).toMatchObject({
            id: 'box', fromMessageId: messages[1].id, toMessageId: third.id, messageCount: 2,
            memoryConversions: entry.archives[0].memoryConversions,
        });
        const rows = await read();
        expect(rows.map(row => !!row.metadata?.theaterArchived)).toEqual([false, true, true]);
        expect(rows.map(row => row.content)).toEqual([...messages, third].map(row => row.content));
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('rejects overlaps and a pending user floor before making any request', async () => {
        const pending = await addFloor('还没得到回应', 'user');
        await expect(archiveStoryFloorRange(entry.id, messages, api)).rejects.toThrow('重叠');
        await expect(archiveStoryFloorRange(entry.id, [pending], api)).rejects.toThrow('还没有回复');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('keeps the old box and flags when source content changes during a re-selection', async () => {
        const third = await addFloor('新的剧情');
        fetchMock.mockImplementationOnce(async () => {
            await DB.updateMessage(third.id, '在另一个窗口修改了这层');
            return response(structured('旧请求生成的摘要'));
        });
        await expect(archiveStoryFloorRange(entry.id, [messages[1], third], api, 'box')).rejects.toThrow('已变更');
        expect((await fresh()).archives).toEqual(entry.archives);
        expect((await read()).map(row => !!row.metadata?.theaterArchived)).toEqual([true, true, false]);
        expect(fetchMock).toHaveBeenCalledOnce();
    });
});

describe('revoking an event box', () => {
    const read = () => DB.getMessagesByCharId(storyTheaterThreadId(entry.id), true);

    it('removes only the summary with no request and frees the same range for re-archiving', async () => {
        const updated = await revokeStoryArchive(entry.id, entry.archives[0]);
        expect(updated.archives).toEqual([]);
        const restored = await read();
        expect(restored.map(row => row.content)).toEqual(messages.map(row => row.content));
        expect(restored.every(row => !row.metadata?.theaterArchived && row.metadata?.theaterSkipAutoArchive)).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
        const archived = await archiveStoryFloorRange(entry.id, restored, api);
        expect(archived.archives[0]).toMatchObject({ fromMessageId: messages[0].id, toMessageId: messages[1].id });
        expect((await read()).every(row => !row.metadata?.theaterSkipAutoArchive)).toBe(true);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('preserves a floor covered by another box and ignores orphan flags when creating an archive', async () => {
        const surviving = { ...entry.archives[0], id: 'overlapping-vector', strategy: 'vector' as const,
            fromMessageId: messages[1].id, messageCount: 1, summary: undefined };
        await DB.saveStoryTheater({ ...entry, archives: [...entry.archives, surviving] });
        await revokeStoryArchive(entry.id, entry.archives[0]);
        expect((await read()).map(row => row.metadata?.theaterArchiveStrategy)).toEqual([undefined, 'vector']);
        expect((await fresh()).archives).toEqual([surviving]);
        await expect(archiveStoryFloorRange(entry.id, await read(), api)).rejects.toThrow('重叠');
        expect(fetchMock).not.toHaveBeenCalled();
        await DB.updateMessageMetadata(messages[0].id, metadata => ({ ...metadata, theaterArchived: true }));
        const selected = (await read()).slice(0, 1);
        await expect(archiveStoryFloorRange(entry.id, selected, api)).resolves.toBeDefined();
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('rolls back floor flags and summary if local storage fails', async () => {
        const original = IDBObjectStore.prototype.put;
        const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
            if (this.name === 'story_theaters') throw new Error('磁盘写入失败');
            return original.apply(this, args);
        });
        try { await expect(revokeStoryArchive(entry.id, entry.archives[0])).rejects.toThrow('磁盘写入失败'); }
        finally { spy.mockRestore(); }
        expect((await fresh()).archives).toEqual(entry.archives);
        expect(await read()).toEqual(messages);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});


describe('independent vector archive', () => {
    const vector = { embedding: { baseUrl: 'https://vector.invalid/v1', apiKey: 'test', model: 'test-vector', dimensions: 3 } };
    const partition = () => storyTheaterThreadId(entry.id);
    const read = () => DB.getMessagesByCharId(partition(), true);
    const queueArchive = (summary: string) => {
        fetchMock.mockResolvedValueOnce(response(structured(summary)));
        fetchMock.mockImplementationOnce(async (_url, init) => response({
            data: JSON.parse(init.body).input.map((_part: string, index: number) => ({ index, embedding: [1, 0, 0] })),
        }));
    };
    const prepare = async () => {
        await revokeStoryArchive(entry.id, entry.archives[0]);
        const { id: _id, ...row } = messages[1];
        const third = { ...row, content: '阿泽把备用钥匙交给小雨。', metadata: { source: 'story_theater', theaterId: entry.id } };
        await DB.saveMessage(third);
        return read();
    };

    it('replaces the vector and restores released floors, then deletes it with no request on undo', async () => {
        const floors = await prepare();
        queueArchive('小雨开始信任阿泽。');
        const initial = await archiveStoryFloorRange(entry.id, floors.slice(0, 2), api, undefined, vector);
        const oldBox = initial.archives[0];
        // A legacy vector box might carry an obsolete summary property.
        // Replacing vectors must not promote that stale prose back into the story.
        await DB.saveStoryTheater({ ...initial, archives: [{ ...oldBox, summary: '旧的场景结尾不应再读取。' }] });
        const oldIds = oldBox.vectorMemoryIds!;
        expect(oldIds).toHaveLength(1);
        expect((await MemoryVectorDB.getAllByCharId(partition())).map(item => item.memoryId)).toEqual(oldIds);
        expect((await loadStoryVectorRecall(initial, floors[1].id)).nodes).toEqual([]);
        expect((await selectStoryVectorRecall(await loadStoryVectorRecall(initial, Infinity), '')).text).toContain('开始信任');
        queueArchive('阿泽把备用钥匙交给小雨，两人成为搭档。');
        const replaced = await archiveStoryFloorRange(entry.id, floors.slice(1), api, oldBox.id, vector);
        expect(replaced.archives).toHaveLength(1);
        expect(replaced.archives[0].summary).toBeUndefined();
        expect(replaced.archives[0].id).toBe(oldBox.id);
        expect(await MemoryNodeDB.getById(oldIds[0])).toBeUndefined();
        expect((await MemoryVectorDB.getAllByCharId(partition())).map(item => item.memoryId)).toEqual(replaced.archives[0].vectorMemoryIds);
        expect((await read()).map(row => !!row.metadata?.theaterArchived)).toEqual([false, true, true]);
        const recall = await loadStoryVectorRecall(replaced, Infinity);
        expect((await selectStoryVectorRecall(recall, '')).text).toContain('成为搭档');
        expect((await selectStoryVectorRecall(recall, '')).text).not.toContain('开始信任');
        const revoked = await revokeStoryArchive(entry.id, replaced.archives[0]);
        expect((await selectStoryVectorRecall(await loadStoryVectorRecall(revoked, Infinity), '')).archiveIds.size).toBe(0);
        expect(await MemoryNodeDB.getByCharId(partition())).toEqual([]);
        expect(await MemoryVectorDB.getAllByCharId(partition())).toEqual([]);
        expect((await read()).map(row => !!row.metadata?.theaterArchived)).toEqual([false, false, false]);
        expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('recalls all sections of a range together or leaves its floors in the request history', async () => {
        const floors = await prepare();
        queueArchive('最先发生的剧情。');
        const first = await archiveStoryFloorRange(entry.id, floors.slice(0, 2), api, undefined, vector);
        const firstId = first.archives[0].vectorMemoryIds![0];
        const node = (await MemoryNodeDB.getById(firstId))!;
        await MemoryNodeDB.save({ ...node, content: '旧'.repeat(5900) });
        const secondId = 'second-section-' + entry.id;
        await MemoryNodeDB.save({ ...node, id: secondId, content: '【好感与心理变化】' + '变化'.repeat(70) });
        const snapshot = { ...first, archives: [{ ...first.archives[0], vectorMemoryIds: [firstId, secondId] }] };
        const recall = await selectStoryVectorRecall(await loadStoryVectorRecall(snapshot, Infinity), '');
        expect(recall.text).toBe('');
        expect(recall.archiveIds.size).toBe(0);
    });

    it('only sends a separate query embedding when saved ranges compete for the recall window', async () => {
        const floors = await prepare();
        queueArchive('先在站台碰面。');
        const first = await archiveStoryFloorRange(entry.id, floors.slice(0, 2), api, undefined, vector);
        queueArchive('后来去了旅馆。');
        const second = await archiveStoryFloorRange(entry.id, floors.slice(2), api, undefined, vector);
        const both = await selectStoryVectorRecall(await loadStoryVectorRecall(second, Infinity), '钥匙在哪里？', vector.embedding);
        expect(both.archiveIds.size).toBe(2);
        expect(fetchMock).toHaveBeenCalledTimes(4);
        for (const box of [first.archives[0], second.archives[1]]) {
            const node = (await MemoryNodeDB.getById(box.vectorMemoryIds![0]))!;
            await MemoryNodeDB.save({ ...node, content: node.content + '细节'.repeat(1600) });
        }
        fetchMock.mockResolvedValueOnce(response({ data: [{ index: 0, embedding: [1, 0, 0] }] }));
        const selected = await selectStoryVectorRecall(await loadStoryVectorRecall(second, Infinity), '钥匙在哪里？', vector.embedding);
        expect(selected.archiveIds.size).toBe(1);
        expect(fetchMock).toHaveBeenCalledTimes(5);
        expect(fetchMock.mock.calls[4][1].__sullyMeta.purpose).toBe('剧情独立向量 · 续写召回');
    });

    it('keeps the previous range and vectors if replacement embedding fails', async () => {
        const floors = await prepare();
        queueArchive('旧向量内容');
        const initial = await archiveStoryFloorRange(entry.id, floors.slice(0, 2), api, undefined, vector);
        fetchMock.mockResolvedValueOnce(response(structured('新向量内容')));
        fetchMock.mockResolvedValueOnce(response({ data: [] }));
        await expect(archiveStoryFloorRange(entry.id, floors.slice(1), api, initial.archives[0].id, vector)).rejects.toThrow();
        expect((await fresh()).archives).toEqual(initial.archives);
        expect((await read()).map(row => !!row.metadata?.theaterArchived)).toEqual([true, true, false]);
        expect((await selectStoryVectorRecall(await loadStoryVectorRecall(initial, Infinity), '')).text).toBe(savedSummary('旧向量内容'));
        expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('revokes legacy boxes as a group without removing newer owned vectors', async () => {
        const floors = await prepare();
        queueArchive('新归档的独立向量');
        const newer = await archiveStoryFloorRange(entry.id, floors.slice(2), api, undefined, vector);
        const ownedId = newer.archives[0].vectorMemoryIds![0];
        const ownedNode = (await MemoryNodeDB.getById(ownedId))!;
        await MemoryNodeDB.save({ ...ownedNode, id: 'legacy-node', content: '旧版共享向量' });
        const legacy = floors.slice(0, 2).map(row => ({
            id: 'legacy-'+row.id, strategy: 'vector' as const, fromMessageId: row.id, toMessageId: row.id, messageCount: 1, createdAt: 1,
        }));
        const withLegacy = { ...newer, archives: [...legacy, ...newer.archives] };
        await DB.saveStoryTheater(withLegacy);
        expect((await loadStoryVectorRecall(withLegacy, Infinity)).nodes).toHaveLength(2);
        const revoked = await revokeStoryArchive(entry.id, legacy[0]);
        expect(revoked.archives).toEqual(newer.archives);
        expect((await loadStoryVectorRecall(revoked, Infinity)).nodes.map(node => node.id)).toEqual([ownedId]);
        expect(await MemoryNodeDB.getById('legacy-node')).toBeUndefined();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
