import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message, StoryArchiveFact, StoryTheaterEntry } from '../types';
import { DB } from './db';
import { MemoryNodeDB, MemoryVectorDB } from './memoryPalace/db';
import { deleteStoryVectorMemory, loadStoryVectorRecall, selectStoryVectorRecall, updateStoryVectorMemory } from './storyTheaterVectorMemory';
import { collectStoryArchiveFacts, filterStoryArchiveBaselineRepeats, findStoryArchiveEvidence, formatStoryArchiveFacts, formatStoryArchiveProseContext, formatStoryArchiveRecallTimeline, formatStoryArchiveTransitions, reconcileStoryArchiveContinuity, storyArchiveModality, parseStoryArchiveChanges, rankStoryArchiveFacts, selectExplicitStoryFacts, storyArchiveFactTime, storyArchiveNeedsRanking, storyArchiveSourceTimes, storyArchiveReadableLines, storyArchiveRepeatsPreset, storyTimeFromSource } from './storyArchiveFacts';
import { buildStoryTheaterRecall } from './storyTheaterRecall';
import { normalizeStoryArchiveGuideMaxChars, STORY_ARCHIVE_DEFAULT_GUIDE_MAX_CHARS } from './storyArchiveLength';
import { createStoryTheaterDraft, selectStoryArchiveBatch, storyTheaterThreadId } from './storyTheater';
import { archiveStoryFloorRange, archiveStoryVectorRangeInGeneration, commitStoryArchiveBatch, generateStoryArchiveDelta, parseStoryArchiveSummary, regenerateStoryArchiveSummary, revokeStoryArchive } from './storyTheaterArchive';

const api = { baseUrl: 'https://llm.invalid/v1/', apiKey: 'test', model: 'test' };
const completion = (content: unknown, finish_reason = 'stop', reasoning_content = '思考过程') => ({ choices: [{ finish_reason, message: { content, reasoning_content } }] });
const fixtureSummary = '两人在车站等雨停，一起走回家。';
const structured = (text: string, init: RequestInit) => {
    const input = JSON.parse(String(init.body)).messages[1].content as string;
    const match = input.split('本批新楼层\n')[1].match(/记录ID (\d+)\]\n([^\n]+)/);
    if (!match) throw new Error('归档测试缺少来源编号');
    return completion(JSON.stringify({ changes: [{
        action: 'add', key: '剧情/事件-' + match[1], kind: 'fact', text, terms: ['车站'],
        sourceMessageId: Number(match[1]), quote: match[2],
    }] }));
};
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
let entry: StoryTheaterEntry, messages: Message[], serial = 0;
const fetchMock = vi.fn();
const fresh = async () => (await DB.getStoryTheaters()).find(item => item.id === entry.id)!;
const regenerate = () => regenerateStoryArchiveSummary(entry.id, 'box', api);

beforeEach(async () => {
    serial++;
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset().mockImplementation(async (_url, init) => response(structured(fixtureSummary, init)));
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
    it('keeps metadata-only updates and ranks more than one aspect of a shared name', () => {
        const previous: StoryArchiveFact = { key: '钥匙/位置', kind: 'fact', text: '铜钥匙放在库房。', terms: ['铜钥匙'], sourceMessageId: 10,
            aliases: ['旧钥匙'] };
        const text = '铜钥匙放在库房，绰号「绿牙」。';
        const returned = parseStoryArchiveChanges(JSON.stringify({ changes: [{ ...previous, action: 'update',
            sourceMessageId: 11, aliases: ['绿牙'], entities: [{ name: '铜钥匙', type: 'object', aliases: ['绿牙'] }] }] }),
            new Map([[11, { text, authorInput: false }]]), [previous]);
        expect(returned).toMatchObject([{ text: previous.text, aliases: ['旧钥匙', '绿牙'],
            entities: [{ name: '铜钥匙', type: 'object', aliases: ['绿牙'] }] }]);
        const creation = { ...previous, key: '钥匙/制作者', text: '林星做了铜钥匙。', sourceMessageId: 8 };
        expect(selectExplicitStoryFacts([creation, returned[0]], '铜钥匙是谁做的，现在在哪？', new Map(), new Map()))
            .toEqual(expect.arrayContaining([creation, returned[0]]));
    });

    it('merges a linked delivery into one complete segment and keeps a reroll-safe earlier record', () => {
        const route = '阿潭因正门桥板断裂改走北门暗道，回执全程未湿。';
        const delivery = '阿潭最终亲手交付南渡回执，柳巡已签收。若蜡封破损，双方暂停交接。';
        const earlier: StoryArchiveFact[] = [];
        const cards = parseStoryArchiveChanges(JSON.stringify({ changes: [
            { action: 'add', key: 'delivery_route', text: route, kind: 'fact', terms: ['回执'], sourceMessageId: 8 },
            { action: 'add', key: 'delivery_outcome', text: delivery, kind: 'fact', continuity: 'completed',
                terms: ['南渡回执'], sourceMessageId: 18, relatedKeys: ['delivery_route'] },
        ] }), new Map([[8, { text: route, authorInput: false }], [18, { text: delivery, authorInput: false }]]), [],
        '', fact => earlier.push(fact));
        expect(cards).toEqual([expect.objectContaining({ text: route + delivery, sourceMessageId: 18 })]);
        const archived = { id: 'one-delivery', strategy: 'summary' as const, fromMessageId: 8, toMessageId: 18,
            messageCount: 2, createdAt: 1, facts: cards, historyFacts: earlier };
        expect(collectStoryArchiveFacts([archived], 18, new Map()).map(item => item.text)).toEqual([route]);
        expect(collectStoryArchiveFacts([archived], 19, new Map()).map(item => item.text)).toEqual([route + delivery]);
    });

    it('corrects wrong model scope, recovers partial work and preserves an unrelated prior delivery', () => {
        const old: StoryArchiveFact = { key: 'delivery_status', kind: 'fact', sourceMessageId: 18, terms: ['南渡回执'],
            text: '南渡回执由阿潭亲手交付，柳巡签收。', continuity: 'completed' };
        const author = '遇密封文书时，柳巡须验灰色骑缝章方可阅读；青灯递交时可免验，此规则仅适用于本批剧情。';
        const cancellation = '柳巡取消前往西渡取备用封条的约定，因潮水倒灌。';
        const sources = new Map([
            [30, { text: '阿潭原计划修北门闸机。今天只完成了拆掉外壳这一项；弹簧仍卡着，闸机没有修好。', authorInput: false }],
            [39, { text: '场外：从此密封文书须验灰色骑缝章，青灯递交时免验。本轮只用一句旁白。', authorInput: true }],
            [42, { text: '柳巡取消了去西渡取备用封条的约定，原因是潮水倒灌。', authorInput: false }],
            [43, { text: '如果取消去西渡的约定，他便留在这里。', authorInput: false }],
        ]);
        const changes = parseStoryArchiveChanges(JSON.stringify({ changes: [
            { key: '写作/验章', kind: 'author', text: author, authorScope: 'turn', terms: ['灰色骑缝章'], sourceMessageId: 39 },
            { key: old.key, action: 'update', kind: 'fact', text: cancellation, sourceMessageId: 42 },
        ] }), sources, [old]);
        expect(changes).toHaveLength(3);
        expect(changes.find(fact => fact.key === '写作/验章')).toMatchObject({ text: author.split('，此规则')[0] + '。' });
        expect(changes.find(fact => fact.key === '写作/验章')?.authorScope).toBeUndefined();
        expect(changes.find(fact => fact.sourceMessageId === 30)).toMatchObject({ modality: 'planned',
            text: expect.stringMatching(/已做：拆掉外壳.*闸机没有修好/u) });
        expect(changes.find(fact => fact.sourceMessageId === 42)).toMatchObject({ key: 'delivery_status/来源42', continuity: 'canceled' });
    });

    it('accepts a fenced completion with string source ID, punctuation key and whitespace-only quote differences', () => {
        const sources = new Map([[12, { text: '阿岚对小雨说：\n今天去钟楼。', authorInput: false }]]);
        const raw = '```json\n' + JSON.stringify({ changes: [{
            action: 'add', key: '阿岚：行程', kind: 'fact', text: '阿岚决定今天去钟楼。',
            terms: ['阿岚', '钟楼'], sourceMessageId: '12', quote: '阿岚对小雨说： 今天去钟楼。',
        }] }) + '\n```';
        expect(parseStoryArchiveChanges(raw, sources, [])).toEqual([expect.objectContaining({
            key: '阿岚:行程', text: '阿岚决定今天去钟楼。', sourceMessageId: 12,
        })]);
    });
    it('accepts closed JSON with trailing commas and irregular optional fields without changing quoted text', () => {
        const text = '她保存了「第2句, }」，铜钥匙仍在木盒。';
        const sources = new Map([[914, { text, authorInput: false, floorNumber: 3 }]]);
        const raw = '{"changes":[{"key":"钥匙/位置","text":' + JSON.stringify(text)
            + ',"kind":" FACT ","action":null,"sourceMessageId":"记录 ＩＤ：９１４","quote":null,"storyTime":null,'
            + '"terms":["铜钥匙",null,],},],}';
        expect(parseStoryArchiveChanges(raw, sources, [])).toEqual([
            expect.objectContaining({ text, terms: ['铜钥匙'], kind: 'fact', sourceMessageId: 914 }),
        ]);
        expect(() => parseStoryArchiveChanges(raw.slice(0, -1), sources, [])).toThrow('完整');
        expect(() => parseStoryArchiveChanges('{"changes":[,]}', sources, [])).toThrow('完整');
        expect(() => parseStoryArchiveChanges(raw.replace('９１４', '９９９'), sources, [])).toThrow('原文记录ID');
    });
    it('recovers an incorrect record ID only if the quote has one unambiguous source', () => {
        const sources = new Map([
            [12, { text: '今天下雨。', authorInput: false }],
            [13, { text: '小雨把铜钥匙放在木盒里。', authorInput: false }],
        ]);
        const raw = JSON.stringify({ changes: [{
            action: 'add', key: '铜钥匙/位置', kind: 'fact', text: '铜钥匙在木盒里。',
            terms: ['铜钥匙'], sourceMessageId: '999', quote: '铜钥匙放在木盒里',
        }] });
        expect(parseStoryArchiveChanges('下面是 JSON：\n' + raw, sources, [])[0]?.sourceMessageId).toBe(13);
        expect(() => parseStoryArchiveChanges(raw, new Map([[12, sources.get(13)!], [13, sources.get(13)!]]), []))
            .toThrow('来源无效');
    });
    it('anchors a paraphrased model quote by real record ID, but never invents a missing source or author instruction', () => {
        const sources = new Map([[12, { text: '阿岚站在车站。', authorInput: false }]]);
        const change = { action: 'add', key: '阿岚/位置', kind: 'fact',
            text: '阿岚仍在车站。', terms: ['阿岚'], sourceMessageId: 12, quote: '阿岚还在车站等候。' };
        expect(parseStoryArchiveChanges(JSON.stringify({ changes: [change] }), sources, []))
            .toEqual([expect.objectContaining({ sourceMessageId: 12, text: '阿岚仍在车站。' })]);
        expect(() => parseStoryArchiveChanges(JSON.stringify({ changes: [{
            ...change, sourceMessageId: 999,
        }] }), sources, [])).toThrow('原文记录ID');
        expect(() => parseStoryArchiveChanges(JSON.stringify({ changes: [{
            ...change, kind: 'author', quote: '阿岚站在车站。',
        }] }), sources, [])).toThrow('作者指令');
    });
    it('accepts missing quotes and infers missing action/terms without losing its source', () => {
        const sources = new Map([[12, { text: '小林把铜钥匙交给阿岚。', authorInput: false }]]);
        const previous = [{ key: '铜钥匙/持有人', kind: 'fact' as const, text: '小林保管铜钥匙。',
            terms: ['铜钥匙'], sourceMessageId: 5 }];
        const raw = JSON.stringify({ changes: [{ key: '铜钥匙/持有人', text: '铜钥匙现在由阿岚保管。',
            sourceMessageId: 12, action: 'add' }] });
        expect(parseStoryArchiveChanges(raw, sources, previous)).toEqual([expect.objectContaining({
            text: '铜钥匙现在由阿岚保管。', sourceMessageId: 12,
            terms: ['铜钥匙', '持有人'],
        })]);
    });
    it('preserves the completed record when the source explicitly starts a new round of the same task', () => {
        const existing: StoryArchiveFact[] = [{ key:'信/交付', kind:'fact', text:'阿岚已经把信交给小林。', terms:[],
            sourceMessageId:5, continuity:'completed' }];
        const newPlan = '阿岚明天打算再送一封信给小林。';
        const change = { action:'update', key:'信/交付', kind:'fact', text:newPlan, modality:'planned', sourceMessageId:6 };
        const facts = parseStoryArchiveChanges(JSON.stringify({ changes:[change] }),
            new Map([[6,{ text:newPlan, authorInput:false }]]), existing);
        expect(facts[0]).toMatchObject({ key:'信/交付/来源6', text:newPlan, modality:'planned' });
    });

    it('keeps a complete segment as a closed outcome even when the model omits continuity', () => {
        const text = '阿潭原本打算从桥上送回执，因桥板损坏改走暗道，柳巡已签收。如果封条破损，暗道不能通行。';
        const condition = '阿潭原本打算从桥上送回执，假如暗门能打开，柳巡届时才可能签收。';
        const rows = new Map([
            [9, { text, authorInput:false }], [10, { text:condition, authorInput:false }],
        ]);
        const changes = [text, condition].map((body, index) => ({ key:'回执/' + index, kind:'fact', text:body,
            sourceMessageId:9 + index, modality:'planned' }));
        const facts = parseStoryArchiveChanges(JSON.stringify({ changes }), rows, []);
        expect(facts[0]).toMatchObject({ text, continuity:'completed' });
        expect(storyArchiveModality(facts[0])).toBeUndefined();
        expect(storyArchiveModality(facts[1])).toBe('planned');
    });

    it('keeps a later exception without treating partial progress as an outcome', () => {
        const finished = '阿潭原本打算走桥，正门受阻后转走暗道，柳巡已签收回执，如果封条破损就要停止通行。';
        const partial = '阿潭原本打算完成检修，眼下完成了第一步，闸机仍卡着。';
        const oneTurn = '略去天气描写（仅限本次续写）。';
        const user = { text: oneTurn, authorInput: true };
        const changes = [finished, partial, oneTurn].map((text, i) => ({ key: '事项/' + i, text,
            kind: i === 2 ? 'author' : 'fact', sourceMessageId: i + 1, ...(i < 2 ? { modality: 'planned' } : {}) }));
        const parsed = parseStoryArchiveChanges(JSON.stringify({ changes }), new Map([
            [1, { text: finished, authorInput: false }], [2, { text: partial, authorInput: false }], [3, user],
        ]), []);
        expect(parsed[0]).toMatchObject({ text: finished, continuity: 'completed' });
        expect(parsed[1]).toMatchObject({ text: partial, modality: 'planned' });
        expect(parsed[2]).toMatchObject({ text: oneTurn, authorScope: 'turn' });
    });

    it('separates explicit scopes when a model returns the same mixed author summary twice', () => {
        const text = '本轮只略去天气，后续正文一律用第三人称，不替玩家回答；玩家亲口回答以后才可写其他人物的反应。';
        const author = { action: 'add', kind: 'author', key: '场外/视角', sourceMessageId: 31, text };
        const output = [{ ...author }, { ...author, key: '场外/天气', authorScope: 'turn' }];
        const parsed = parseStoryArchiveChanges(JSON.stringify({ changes: output }), new Map([[31, { text, authorInput: true }]]), []);
        expect(parsed.map(fact => [fact.text, fact.authorScope])).toEqual([
            ['后续正文一律用第三人称，不替玩家回答；玩家亲口回答以后才可写其他人物的反应。', undefined],
            ['本轮只略去天气。', 'turn'],
        ]);
    });

    it('keeps a long-term instruction when a trailing one-turn sentence starts with its subject', () => {
        const text = '后续正文采用第三人称。除非玩家先回答，否则不描写他人的反应。本轮天气描述被略去。';
        const changes = [{ action: 'add', kind: 'author', key: '写作/视角', sourceMessageId: 31, authorScope: 'turn', text }];
        const parsed = parseStoryArchiveChanges(JSON.stringify({ changes }), new Map([[31, { text, authorInput: true }]]), []);
        expect(parsed.map(fact => [fact.text, fact.authorScope])).toEqual([
            ['后续正文采用第三人称。除非玩家先回答，否则不描写他人的反应。', undefined],
            ['本轮天气描述被略去。', 'turn'],
        ]);
    });

    it('protects a settled archive when the model reuses its key for a different writing rule', () => {
        const known: StoryArchiveFact = { key: '回执/交付', kind: 'fact', text: '柳巡已签收回执。',
            terms: ['柳巡', '回执'], continuity: 'completed', sourceMessageId: 18 };
        const rule = '以后密封文书要验灰色骑缝章。';
        const change = { action: 'add', key: known.key, kind: 'fact', continuity: 'rule', text: rule,
            terms: ['密封文书', '灰色骑缝章'], sourceMessageId: 40 };
        const sources = new Map([[40, { text: '门旁很安静。', authorInput: false }],
            [41, { text: rule, authorInput: false }]]);
        const parsed = parseStoryArchiveChanges(JSON.stringify({ changes: [change, { ...change, sourceMessageId: 41 }] }),
            sources, [known]);
        expect(parsed).toEqual([expect.objectContaining({ key: '回执/交付/规则/来源41', text: rule, continuity: 'rule' })]);
    });

    it('ignores an exact already-saved item echoed with its old source without dropping new memory', () => {
        const old: StoryArchiveFact = { key:'写作/代写', kind:'author', text:'不替玩家做决定。', terms:[], sourceMessageId:2 };
        const text = '旁人只有在青灯亲口告知后，才知晓灰港真名。';
        const fresh = { key:'写作/知情', kind:'author', text, sourceMessageId:19 };
        const sources = new Map([[19,{ text, authorInput:true, floorNumber:7 }]]);
        const changes = [old,fresh];
        expect(parseStoryArchiveChanges(JSON.stringify({ changes }), sources, [old])).toEqual([
            expect.objectContaining(fresh),
        ]);
        expect(() => parseStoryArchiveChanges(JSON.stringify({ changes:[{ ...old, text:'代替玩家做决定。' },fresh] }),
            sources, [old])).toThrow('原文记录ID');
    });

    it('discards a renamed old event cited by the model and keeps other changes with valid current evidence', () => {
        const old: StoryArchiveFact = { key: '银钥/交付', kind: 'fact', text: '闻霜已在第三天清晨把银钥交给青灯。',
            terms: ['银钥'], sourceMessageId: 1001, continuity: 'completed' };
        const echo = { action: 'add', key: '闻霜/送钥匙', kind: 'fact',
            text: '第三天清晨，闻霜把银钥交给青灯。', sourceMessageId: '1001' };
        const fresh = { action: 'add', key: '柳巡/收件', kind: 'fact',
            text: '柳巡已签收回执。', sourceMessageId: 1002 };
        const rumor = { action: 'add', key: '账册/位置', kind: 'fact', text: '账册或许在井里，尚未验证。', sourceMessageId: 1003 };
        const sources = new Map([
            [1002, { text: fresh.text, authorInput: false, floorNumber: 1001 }],
            [1003, { text: rumor.text, authorInput: false, floorNumber: 1002 }],
        ]);
        expect(parseStoryArchiveChanges(JSON.stringify({ changes: [echo, fresh, rumor] }), sources, [old])).toEqual([
            expect.objectContaining({ key: fresh.key, sourceMessageId: 1002, continuity: 'completed' }),
            expect.objectContaining({ key: rumor.key, sourceMessageId: 1003, modality: 'unverified' }),
        ]);
        expect(parseStoryArchiveChanges(JSON.stringify({ changes: [{ ...echo, action: 'update', key: old.key }, fresh] }),
            sources, [old])).toEqual([expect.objectContaining({ key: fresh.key, sourceMessageId: 1002 })]);
        expect(() => parseStoryArchiveChanges(JSON.stringify({ changes: [echo] }), sources, [old])).toThrow('只引用了旧归档');
        expect(() => parseStoryArchiveChanges(JSON.stringify({ changes: [{ ...echo, sourceMessageId: 999 }, fresh] }),
            sources, [old])).toThrow('原文记录ID');
    });
    it('resolves visible floor numbers back to actual records if a cheap model confuses them', () => {
        const sources = new Map([[914, { text: '阿岚把钥匙交给小雨。', authorInput: false, floorNumber: 3 }]]);
        const make = (sourceMessageId: number | string) => JSON.stringify({ changes: [{
            key: '钥匙/归属', text: '小雨现在持有钥匙。', sourceMessageId,
            quote: '小雨现在拿着钥匙。',
        }] });
        for (const ref of ['第3楼', '3', 3]) {
            expect(parseStoryArchiveChanges(make(ref), sources, [])[0]?.sourceMessageId).toBe(914);
        }
        expect(() => parseStoryArchiveChanges(make('第4楼'), sources, [])).toThrow('原文记录ID');
        expect(parseStoryArchiveChanges(make('recordID_914'), sources, [])[0]?.sourceMessageId).toBe(914);
        expect(() => parseStoryArchiveChanges(make('recordID_3').replace(/,"quote":"[^"]*"/u, ''), sources, [])).toThrow('原文记录ID');
    });
    it('anchors explicit in-story time without manufacturing real dates or changing floor order', () => {
        const original = new Map([[111, { text: '第一天傍晚，小林保管铜钥匙。', authorInput: false }]]);
        const later = new Map([[222, { text: '第二天清晨，小林把铜钥匙交给阿岚。', authorInput: false }]]);
        const first = parseStoryArchiveChanges(JSON.stringify({ changes: [{
            action: 'add', key: '铜钥匙/持有人', kind: 'fact', text: '小林保管铜钥匙。',
            terms: ['钥匙'], sourceMessageId: 111, quote: '小林保管铜钥匙。',
        }] }), original, []);
        const second = parseStoryArchiveChanges(JSON.stringify({ changes: [{
            action: 'update', key: '铜钥匙/持有人', kind: 'fact', text: '阿岚保管铜钥匙。',
            terms: ['阿岚', '铜钥匙'], sourceMessageId: 222,
            storyTime: '第二天清晨', quote: '小林把铜钥匙交给阿岚。',
        }] }), later, first);
        expect(first[0].storyTime).toBe('第一天傍晚');
        expect(second[0].storyTime).toBe('第二天清晨');
        const archives = [
            { id: 'a', strategy: 'summary' as const, fromMessageId: 111, toMessageId: 111,
                messageCount: 1, createdAt: 1, facts: first },
            { id: 'b', strategy: 'summary' as const, fromMessageId: 222, toMessageId: 222,
                messageCount: 1, createdAt: 2, facts: second },
        ];
        const floors = new Map([[111, 3], [222, 17]]);
        const sourceTimes = new Map([[111, '第一天傍晚'], [222, '第二天清晨']]);
        expect(formatStoryArchiveTransitions(archives, Infinity, floors, sourceTimes))
            .toBe('[第 3 楼 · 剧情时间：第一天傍晚] 小林保管铜钥匙。');
        expect(formatStoryArchiveFacts(collectStoryArchiveFacts(archives, Infinity, new Map()), floors, 6000, true))
            .toBe('[第 17 楼 · 剧情时间：第二天清晨] 阿岚保管铜钥匙。');
        expect(storyTimeFromSource('小林把铜钥匙放进木箱。')).toBeUndefined();
        expect(parseStoryArchiveChanges(JSON.stringify({ changes: [{
            action: 'add', key: '箱子/位置', text: '箱子在地下室。', sourceMessageId: 111,
            storyTime: '2039年1月1日', quote: '第一天傍晚',
        }] }), original, [])[0].storyTime).toBe('第一天傍晚');
    });
    it('inherits adjacent scene headings, keeps recurring events, and excludes paraphrased profile facts', () => {
        const rows = [
            { id: 1, content: '第一天早上。' },
            { id: 2, content: '完成巡查。值班员是登记员。' },
            { id: 3, content: '第二天晚上。' },
            { id: 4, content: '完成巡查。今天曾有人传言系统故障。' },
            { id: 5, content: '材料昨天已提交。明天才会领取回执。' },
        ];
        const sources = new Map(rows.map(row => [row.id, { text: row.content, authorInput: false }]));
        const raw = JSON.stringify({ changes: [
            { action: 'add', key: '巡查/完成', text: '已完成巡查。', sourceMessageId: 2 },
            { action: 'add', key: '职业/资料', text: '值班员的职业是登记员。', sourceMessageId: 2 },
            { action: 'add', key: '巡查/完成', text: '已完成巡查。', storyTime: '今天', sourceMessageId: 4 },
            { action: 'add', key: '回执/领取', text: '将领取回执。', storyTime: '昨天', sourceMessageId: 5,
                quote: '明天才会领取回执。', modality: 'planned' },
            { action: 'add', key: '材料/提交', text: '已提交材料。', storyTime: '昨天', sourceMessageId: 5 },
        ] });
        const facts = parseStoryArchiveChanges(raw, sources, [], '值班员是登记员。', undefined, storyArchiveSourceTimes(rows));
        expect(facts.map(fact => [fact.text, fact.storyTime])).toEqual([
            ['已完成巡查。', '第一天早上'], ['已完成巡查。', '第二天晚上'],
            ['将领取回执。', undefined], ['已提交材料。', undefined],
        ]);
        expect(facts[0].key).not.toBe(facts[1].key);
    });

    it('checks labelled details against source, recovers omissions, and preserves uncertainty', () => {
        const rows = [
            { id: 1, content: '第一天上午，库房回执编号是 74851。库房找到铜牌。' },
            { id: 2, content: '第二天中午，检修申请的档案编号是 G-5612。第三天黎明，撤下了旧标志。' },
            { id: 3, content: '据说电台校验码是 Z-1234，尚未有人核实。' },
            { id: 4, content: '叶澄多年担任港务登记员。叶澄确认蓝柜已经关好。' },
            { id: 5, content: '叶澄在第四天傍晚把窗户关好。' },
        ];
        const sources = new Map(rows.map(row => [row.id, {text:row.content,authorInput:false}]));
        const changes = [
            {key:'库房/铜牌',text:'库房找到铜牌。',sourceMessageId:1,quote:'库房找到铜牌。'},
            {key:'检修/申请',text:'检修申请的档案编号是 G-5613。',sourceMessageId:2,quote:'第二天中午，检修申请的档案编号是 G-5612。'},
            {key:'检修/标志',text:'撤下了旧标志。',sourceMessageId:2,storyTime:'第二天中午',quote:'第三天黎明，撤下了旧标志。'},
            {key:'电台/传闻',text:'电台校验码是 Z-1234。',sourceMessageId:3,quote:rows[2].content},
            {key:'电台/编造',text:'电台校验码是 Z-9999。',sourceMessageId:4,quote:'叶澄确认蓝柜已经关好。'},
            {key:'叶澄/职业',text:'叶澄的职业是港务登记员。',sourceMessageId:4,quote:'叶澄多年担任港务登记员。'},
            {key:'资料室/窗户',text:'叶澄关好了窗户。',sourceMessageId:5,storyTime:'第四天傍晚',quote:rows[4].content},
        ];
        const facts = parseStoryArchiveChanges(JSON.stringify({changes}), sources, [], '叶澄是港务登记员。', undefined, storyArchiveSourceTimes(rows));
        expect(facts).toHaveLength(6);
        expect(facts.find(fact=>fact.key==='资料室/窗户')?.storyTime).toBe('第四天傍晚');
        expect(facts.find(fact=>fact.key==='检修/申请')).toMatchObject({text:'检修申请的档案编号是 G-5612。',storyTime:'第二天中午'});
        expect(facts.find(fact=>fact.key==='检修/标志')?.storyTime).toBe('第三天黎明');
        expect(facts.find(fact=>fact.key==='电台/传闻')?.modality).toBe('unverified');
        expect(facts.find(fact=>fact.text.includes('74851'))).toMatchObject({sourceMessageId:1,storyTime:'第一天上午'});
        expect(facts.filter(fact=>fact.sourceMessageId===3)).toHaveLength(1);
        expect(facts.some(fact=>fact.sourceMessageId===4)).toBe(false);
    });

    it('does not classify a newly happened action as a plan due to a later recap on the same floor', () => {
        const text = '柳巡把已签收的南渡回执收进案头窄匣。';
        const source = '柳巡把已签收的南渡回执收进案头窄匣，两人提起阿潭早先打算从正门送来回执。';
        const changes = [{ action: 'add', key: '南渡回执/收纳', kind: 'fact', sourceMessageId: 22, text }];
        const [fact] = parseStoryArchiveChanges(JSON.stringify({ changes }),
            new Map([[22, { text: source, authorInput: false }]]), []);
        expect(fact.text).toBe(text);
        expect(storyArchiveModality(fact)).toBeUndefined();
    });

    it('does not add a second memory for a code already covered by a condensed event segment', () => {
        const source = '阿潭在北亭亲手交付南渡回执，柳巡签收；登记编号为 R-319。';
        const text = '阿潭绕道后将南渡回执交给柳巡，柳巡签收并登记为 R-319。';
        const changes = [{ action: 'add', key: '南渡回执/交付', kind: 'fact', sourceMessageId: 18, text }];
        const facts = parseStoryArchiveChanges(JSON.stringify({ changes }),
            new Map([[18, { text: source, authorInput: false }]]), []);
        expect(facts.map(fact => fact.text)).toEqual([text]);
    });

    it('retains a grouped segment with a confirmed earlier code and rejects an invented or ambiguous one', () => {
        const sources = new Map([
            [1, { text: '回执编号为 DL-74。桥板被风浪撞坏。', authorInput: false }],
            [2, { text: '早期另一张回执作废，回执编号为 DC-12。', authorInput: false }],
            [3, { text: '阿潭改走暗道，柳巡已签收。水手不知道暗道的位置。', authorInput: false }],
        ]);
        const text = '桥板损坏后，阿潭改走暗道交给柳巡，柳巡已签收，回执编号为 DL-74。';
        const change = { key: '柳巡/交接', kind: 'fact', text, sourceMessageId: 3, continuity: 'completed' };
        const parse = (body: typeof change) => parseStoryArchiveChanges(JSON.stringify({ changes: [body] }), sources, []);
        expect(parse(change).some(fact => fact.key === change.key)).toBe(false);
        sources.delete(2);
        expect(parse(change)).toEqual([expect.objectContaining({ text, sourceMessageId: 3, continuity: 'completed' })]);
        expect(parse({ ...change, text: text.replace('DL-74', 'DL-75') }).some(fact => fact.key === change.key)).toBe(false);
    });

    it('recovers an omitted condition on Continue even when the recent prose already mentions its subject', () => {
        const rows = [
            {id:1,content:'旧闸左灯双闪时，救生艇必须停在退水石阶外。领航员把航线表交给站务。'},
            {id:2,content:'领航员抬手指向旧闸左灯，确认这次双闪能不能进。'},
        ];
        const archives = [{id:'old',strategy:'vector' as const,createdAt:1,
            fromMessageId:1,toMessageId:1,messageCount:1,vectorMemoryIds:[],facts:[]}];
        const excerpt=findStoryArchiveEvidence(rows,archives,3,rows[1].content,rows[1].content,'',new Map([[1,1],[2,2]]));
        expect(excerpt).toBe('[第 1 楼] 旧闸左灯双闪时，救生艇必须停在退水石阶外。');
    });

    it('can recover two related details on the same archived floor without including the rest of the floor', () => {
        const rows = [{ id: 1, content: '阿潭用北门暗道护送回执到西库。远处酒馆换了掌柜。北门暗道只在封条完好时通行。' }];
        const archives = [{ id: 'old', strategy: 'vector' as const, createdAt: 1, fromMessageId: 1, toMessageId: 1,
            messageCount: 1, vectorMemoryIds: [], facts: [] }];
        const excerpt = findStoryArchiveEvidence(rows, archives, 2, '北门暗道怎么走？', '', '', new Map([[1, 1]]));
        expect(excerpt).toBe('[第 1 楼] 阿潭用北门暗道护送回执到西库。 … 北门暗道只在封条完好时通行。');
    });

    it('does not retrieve unrelated generic questions or duplicate a fact already sent from that floor', () => {
        const rows = [
            {id:1, role:'assistant',content:'第二天上午，巡堤员已完成南堤巡查。'},
            {id:2, role:'user',content:'核对阿禾什么时候能出院。'},
            {id:3, role:'user',content:'向站务员确认检修申请的档案编号。'},
            {id:4, role:'assistant',content:'检修申请的档案编号是 G-5612，申请订在旧记录夹。'},
        ];
        const archives = [{id:'old',strategy:'vector' as const,createdAt:1,
            fromMessageId:1,toMessageId:4,messageCount:4,vectorMemoryIds:[],facts:[]}];
        const known='[第 1 楼 · 剧情时间：第二天上午] 巡堤员已完成南堤巡查。\n[第 4 楼] 档案编号是 G-5612。';
        const floors=new Map(rows.map(row=>[row.id,row.id]));
        expect(findStoryArchiveEvidence(rows,archives,10,'回看南堤巡查，分别是什么时候？',known,'',floors)).toBe('');
        expect(findStoryArchiveEvidence(rows,archives,10,'检修申请的档案编号呢？',known,'',floors)).toBe('');
        expect(findStoryArchiveEvidence(rows,archives,10,'旧记录夹放了什么？',known,'',floors)).toContain('申请订在旧记录夹');
    });

    it.each([
        ['下葬后她回到新家。', '下葬后'],
        ['下葬当夜她仍在客厅。', '下葬当夜'],
        ['值班员死后数日才有人看见档案。', '死后数日'],
        ['头七子时阴阳交界时，她听见动静。', '头七子时阴阳交界时'],
        ['头七夜零点交界，门边站着一人。', '头七夜零点交界'],
        ['头七过后的首个冬日清晨，众人再次碰面。', '头七过后的首个冬日清晨'],
        ['她计划头七过后再去。', undefined],
        ['她在窗边等人。', undefined],
    ])('recognizes narrative time from old cards and their original floors: %s', (text, expected) => {
        const fact = {kind:'fact' as const, text, sourceMessageId:11};
        expect(storyTimeFromSource(text)).toBe(expected);
        expect(storyArchiveFactTime(fact)).toBe(expected);
        expect(storyArchiveFactTime({ ...fact, kind:'author' })).toBeUndefined();
    });

    it('prioritizes an older memory when a query names its narrative time', () => {
        const earlier={key:'较早/重逢',kind:'fact' as const,terms:['旧屋'],text:'家人收到一封信。',sourceMessageId:3};
        const later={...earlier,key:'最近/重逢',sourceMessageId:4,text:'家人收拾木匣。'};
        expect(rankStoryArchiveFacts([earlier,later],'头七过后家人做了什么？',new Map(),new Map([[3,'头七过后']]))[0]).toBe(earlier);
    });

    it('keeps the same confirmed-memory budget when another memory is added', () => {
        const facts = Array.from({length:13},(_,index)=>({
            key:'fact-'+index, kind:'fact' as const, terms:[], sourceMessageId:index+1,
            text:'这条独立剧情事实用于核对上下文是否按同一容量保留。'.repeat(6)+'记录'+index+'。',
        }));
        expect(storyArchiveNeedsRanking(facts,new Map(),new Map())).toBe(false);
        expect(formatStoryArchiveProseContext(facts,'')).toContain('记录0。');
        expect(formatStoryArchiveProseContext(facts,'')).toContain('记录12。');
    });

    it('only treats a rumor as resolved when the actual assertion confirms it', () => {
        expect(storyArchiveModality({ text: '泵房的水位尺确认正常，之前传闻因刻度图拿错。' })).toBeUndefined();
        expect(storyArchiveModality({ text: '泵房的水位尺还没有确认正常，之前传闻因刻度图拿错。' })).toBe('unverified');
        expect(storyArchiveModality({ text: '据说水位尺确认正常，之前传闻因刻度图拿错。' })).toBe('unverified');
        expect(storyArchiveModality({ text: '据说巡检员已经证实水位尺正常。' })).toBe('unverified');
        expect(storyArchiveModality({ text: '巡检员尚未最终证实水位尺正常。' })).toBe('unverified');
        expect(storyArchiveModality({ text: '先前传闻水位尺出错，巡检员最终证实水位尺正常。' })).toBeUndefined();
        expect(storyArchiveModality({ text: '计划明早检查水位尺。' })).toBe('planned');
    });

    it('keeps the last confirmed fact beside an uncertain update in the same archive', () => {
        const confirmed = { key:'钥匙/持有人', kind:'fact' as const, text:'叶澄保管钥匙。', terms:['钥匙'], sourceMessageId:1 };
        const rumored = { ...confirmed, text:'听说钥匙已经交给站务员。', sourceMessageId:2 };
        const archive = { id:'vector', strategy:'vector' as const, fromMessageId:1, toMessageId:2,
            createdAt:1, messageCount:2, facts:[rumored], historyFacts:[confirmed] };
        const floors = new Map([[1,1],[2,2]]);
        const facts = collectStoryArchiveFacts([archive], Infinity, new Map(), true);
        expect(facts).toEqual([confirmed, rumored]);
        const timeline = formatStoryArchiveRecallTimeline(facts, [confirmed], '', floors, new Map(), new Map());
        expect(timeline).toBe('[第 1 楼] 【已发生】叶澄保管钥匙。\n[第 2 楼] 【尚未核实的说法】听说钥匙已经交给站务员。');
        const deleted = { ...archive, facts:[{ ...rumored, vectorTextState:'deleted' as const }] };
        expect(collectStoryArchiveFacts([deleted], Infinity, new Map(), true)).toEqual([]);
        expect(collectStoryArchiveFacts([archive], 2, new Map(), true)).toEqual([confirmed]);
    });

    it('caps a single oversized fact and excludes hidden reasoning from raw fallback evidence', () => {
        const long = { key:'剧情/旧记录', kind:'fact' as const, text:'城门。'.repeat(2000), terms:['城门'], sourceMessageId:1 };
        const context = formatStoryArchiveRecallTimeline([long], [], '城门', new Map([[1,1]]), new Map(), new Map());
        expect(context).toHaveLength(3200);
        expect(context.endsWith('…')).toBe(true);
        const archive = { id:'vector', strategy:'vector' as const, fromMessageId:1, toMessageId:1, createdAt:1,
            messageCount:1, facts:[long] };
        const row = { id:1, role:'assistant', content:'<think>入口暗号在楼梯下面。</think>守门人打开了城门。' };
        expect(findStoryArchiveEvidence([row], [archive], 2, '入口暗号在哪里', '', '', new Map([[1,1]]))).toBe('');
    });

    it('can repeatedly rank synced text locally before a real vector node exists', async () => {
        const text='夜间门闩由车站管理员保管。';
        const id=entry.id+'-missing-node';
        const box={id:'saved-vector',strategy:'vector' as const,fromMessageId:messages[0].id,toMessageId:messages[1].id,
            messageCount:2,createdAt:1,vectorMemoryIds:[id],
            facts:[{key:'门闩/位置',kind:'fact' as const,text,terms:[],sourceMessageId:messages[0].id,
                vectorNodeId:id,vectorTextState:'synced' as const}]};
        const snapshot={...entry,archives:[box]};
        await DB.saveStoryTheater(snapshot);
        expect((await loadStoryVectorRecall(snapshot,messages[1].id)).factNodes).toHaveLength(1);
        for (let turn=0;turn<3;turn++) {
            const recall=await loadStoryVectorRecall(snapshot,Infinity);
            expect(recall.factNodes).toEqual([expect.objectContaining({id,content:text,embedded:false})]);
            const picked=await selectStoryVectorRecall(recall,'问一下夜间门闩',undefined,recall.factNodes,true);
            expect(picked.semanticFactRank.has(id)).toBe(true);
        }
        expect(fetchMock).not.toHaveBeenCalled();
        expect(await MemoryNodeDB.getById(id)).toBeUndefined();
    });

    it('selects relevant facts but presents them chronologically in prose context', () => {
        const facts = [
            { key: '甲/地点', kind: 'fact' as const, text: '甲在庭院。', terms: ['庭院'], sourceMessageId: 11 },
            { key: '乙/钥匙', kind: 'fact' as const, text: '乙收到了钥匙。', terms: ['钥匙'], sourceMessageId: 30 },
        ];
        const ranked = rankStoryArchiveFacts(facts, '钥匙');
        expect(ranked[0].sourceMessageId).toBe(30);
        expect(formatStoryArchiveFacts(ranked, new Map([[11, 2], [30, 9]]), 6000, true))
            .toBe('[第 2 楼] 甲在庭院。\n[第 9 楼] 乙收到了钥匙。');
    });
    it('classifies future plans and unverified reports distinctly, then updates to a confirmed event', () => {
        const first = new Map([
            [11, { text: '林星说明天打算查看侧门。', authorInput: false, floorNumber: 4 }],
            [12, { text: '有人听说钟楼地下有地图，但没人核实。', authorInput: false, floorNumber: 5 }],
        ]);
        const input = JSON.stringify({ changes: [
            { action: 'add', key: '侧门/调查状态', kind: 'fact',
                text: '林星打算明天检查侧门。', modality: 'planned',
                terms: ['侧门'], sourceMessageId: 11 },
            { action: 'add', key: '钟楼/地图', kind: 'fact',
                text: '传闻钟楼地下有地图，尚未核实。', modality: 'unverified',
                terms: ['地图'], sourceMessageId: 12 },
        ] });
        const existing = parseStoryArchiveChanges(input, first, []);
        const displayed = formatStoryArchiveFacts(existing, new Map([[11, 4], [12, 5]]), 6000, true);
        expect(displayed).toContain('【尚未发生的计划】林星打算明天检查侧门。');
        expect(displayed).toContain('【尚未核实的说法】传闻钟楼地下有地图，尚未核实。');
        const confirmed = parseStoryArchiveChanges(JSON.stringify({ changes: [{
            action: 'update', key: '侧门/调查状态', kind: 'fact',
            text: '林星已在第二天清晨检查侧门。', terms: ['侧门'],
            sourceMessageId: 16, storyTime: '第二天清晨',
        }] }), new Map([[16, { text: '第二天清晨，林星检查了侧门。', authorInput: false, floorNumber: 16 }]]), existing);
        expect(confirmed[0].modality).toBeUndefined();
        expect(formatStoryArchiveFacts(confirmed, new Map([[16, 16]]))).toContain('林星已在第二天清晨检查侧门。');
        expect(formatStoryArchiveFacts(confirmed)).not.toContain('尚未发生的计划');
    });
    it('retrieves an old but relevant plot transition under a tight history budget, then orders selected facts by floor', () => {
        const archives = Array.from({ length: 22 }, (_, i) => ({
            id: 'history-' + i, strategy: 'summary' as const,
            fromMessageId: i + 1, toMessageId: i + 1, messageCount: 1, createdAt: i,
            facts: [{ key: '调查/线索', kind: 'fact' as const,
                text: i === 0 ? '蓝雨暗号是进入钟楼的线索。' : '调查队第' + (i + 1) + '次改变了行动路线。',
                terms: i === 0 ? ['蓝雨暗号', '钟楼'] : ['路线'],
                sourceMessageId: i + 1 }],
        }));
        const floors = new Map(Array.from({ length: 22 }, (_, i) => [i + 1, i + 1]));
        const newestOnly = formatStoryArchiveTransitions(archives, Infinity, floors, undefined, 60);
        expect(newestOnly).not.toContain('蓝雨暗号');
        const relevant = formatStoryArchiveTransitions(archives, Infinity, floors, undefined, 60, '蓝雨暗号在哪');
        expect(relevant).toContain('[第 1 楼] 蓝雨暗号是进入钟楼的线索。');
    });
    it('video regression: archive rendering sorts all remembered events together, not an enormous history block before floor one', () => {
        const archived = {
            id: 'video-case', strategy: 'vector' as const, fromMessageId: 1, toMessageId: 20,
            messageCount: 20, createdAt: 1,
            historyFacts: [
                { key: '葬礼/安排', kind: 'fact' as const, text: '葬礼结束后返回旧城。',
                    terms: ['葬礼'], sourceMessageId: 3 },
                { key: '水果店/调查', kind: 'fact' as const, text: '午后去水果店找线索。',
                    terms: ['水果店'], sourceMessageId: 9 },
            ],
            facts: [
                { key: '事故/结果', kind: 'fact' as const, text: '早前发生车祸，随后举行葬礼。',
                    terms: ['车祸'], sourceMessageId: 1 },
            ],
        };
        const lines = storyArchiveReadableLines(archived, new Map([[1, 1], [3, 3], [9, 9]]));
        expect(lines).toHaveLength(3);
        expect(lines[0]).toContain('第 1 楼');
        expect(lines[1]).toContain('第 3 楼');
        expect(lines[2]).toContain('第 9 楼');
        expect(lines.join('\n')).not.toContain('2026/11/16');
    });
    it('video regression: avoid copying user bio, but preserve actual discoveries or identity changes', () => {
        const baseline = '【用户执笔身份】\n姓名：幸福\n23岁，大学毕业，是幸芳白的亲妹妹。';
        const profile = '{{user}}全名为幸福，现年23岁，大学毕业，是幸芳白的亲妹妹。';
        const source = new Map([[10, { text: profile, authorInput: true }]]);
        const raw = JSON.stringify({ changes: [{
            action: 'add', key: '幸福/基本信息', kind: 'fact', text: profile,
            terms: ['幸福'], sourceMessageId: 10, quote: profile,
        }] });
        expect(storyArchiveRepeatsPreset(profile, '幸福/基本信息', baseline)).toBe(true);
        expect(parseStoryArchiveChanges(raw, source, [], baseline)).toEqual([]);
        const discovered = '幸福第一次得知自己有一个同父异母的姐姐。';
        expect(parseStoryArchiveChanges(JSON.stringify({ changes: [{
            action: 'add', key: '幸福/新得知的身世', kind: 'fact', text: discovered,
            sourceMessageId: 20, terms: ['幸福'],
        }] }), new Map([[20, { text: discovered, authorInput: false }]]), [], baseline)).toHaveLength(1);
    });
    it('uses specific event keys instead of treating unrelated scenes as one changing state', () => {
        const rows = new Map([
            [1, { text: '早餐在车站吃饭。', authorInput: false }],
            [2, { text: '下午从车站去了书店。', authorInput: false }],
        ]);
        const found = parseStoryArchiveChanges(JSON.stringify({ changes: [
            { key: '剧情/进展', text: '早餐在车站吃饭。', sourceMessageId: 1 },
            { key: '剧情/进展', text: '下午从车站去了书店。', sourceMessageId: 2 },
        ] }), rows, []);
        expect(found).toHaveLength(2);
        expect(found[0].key).not.toBe(found[1].key);
        expect(found.map(fact => fact.text)).toEqual(['早餐在车站吃饭。', '下午从车站去了书店。']);
    });
    it('sends confirmed events, pending plans, rumors and user writing boundaries in distinct compact sections', () => {
        const facts = [
            { key: '钥匙/位置', kind: 'fact' as const, text: '钥匙放进铁盒。',
                terms: ['钥匙'], sourceMessageId: 2 },
            { key: '书店/计划', kind: 'fact' as const, modality: 'planned' as const,
                text: '林星打算明天去书店。', terms: ['书店'], sourceMessageId: 3 },
            { key: '门后/传闻', kind: 'fact' as const, modality: 'unverified' as const,
                text: '有人说门后藏着地图，尚未证实。', terms: ['门'], sourceMessageId: 4 },
            { key: '用户/行动', kind: 'author' as const,
                text: '不要擅自替用户做决定。', terms: ['用户'], sourceMessageId: 5 },
        ];
        const text = formatStoryArchiveProseContext(facts, '钥匙和书店');
        expect(text).toContain('【已确认的剧情事实');
        expect(text).toContain('【尚未发生的计划和承诺');
        expect(text).toContain('【未经证实的信息');
        expect(text).toContain('【用户明确提出的写作要求】');
        expect(text.indexOf('钥匙放进铁盒')).toBeLessThan(text.indexOf('林星打算明天去书店'));
        expect(text).not.toContain('本段历史变化');
    });
    it('video regression: legacy vector facts reading preserves future plans and rumors without altering saved data', () => {
        const planned = { text: '幸福决定忙完水果店事务后前往老房子寻找线索。' };
        const uncertain = { text: '据说老房子的阁楼藏有钥匙，尚未证实。' };
        const completed = { text: '幸福决定去老房子，后来已经前往并找到了线索。' };
        expect(storyArchiveModality(planned)).toBe('planned');
        expect(storyArchiveModality(uncertain)).toBe('unverified');
        expect(storyArchiveModality(completed)).toBeUndefined();
        expect(formatStoryArchiveProseContext([
            { key: '寻找线索/安排', kind: 'fact', sourceMessageId: 2, terms: ['老房子'], ...planned },
            { key: '阁楼/传闻', kind: 'fact', sourceMessageId: 4, terms: ['阁楼'], ...uncertain },
        ], '老房子')).toContain('【尚未发生的计划】');
        expect(planned).toEqual({ text: '幸福决定忙完水果店事务后前往老房子寻找线索。' });
    });
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
    it('does not re-archive existing role/worldbook setup, but retains a genuinely new event', async () => {
        const originalCharacters = vi.spyOn(DB, 'getAllCharacters').mockResolvedValue([{
            id: 'existing-actor', name: '阿泽', description: '阿泽是医生。',
            systemPrompt: '阿泽善于救人。', worldview: '故事发生在雾城。',
        } as any]);
        const originalBooks = vi.spyOn(DB, 'getAllWorldbooks').mockResolvedValue([
            { id: 'book-selected', title: '夜间医院', content: '医院夜间关闭。', category: '设定' } as any,
            { id: 'book-other', title: '未选择的设定', content: '秘密飞船会在天亮前出现。', category: '设定' } as any,
        ]);
        try {
            entry.characterIds = ['existing-actor'];
            entry.selectedWorldbookIds = ['book-selected'];
            const raw = JSON.stringify({ changes: [
                { key: '阿泽/职业', kind: 'fact', text: '阿泽是医生。',
                    terms: ['阿泽'], sourceMessageId: messages[0].id },
                { key: '医院/夜间规则', kind: 'fact', text: '医院夜间关闭。',
                    terms: ['医院'], sourceMessageId: messages[0].id },
                { key: '阿泽/承诺', kind: 'fact', text: '阿泽答应陪小雨走回家。',
                    terms: ['阿泽', '小雨'], sourceMessageId: messages[1].id },
            ] });
            fetchMock.mockResolvedValueOnce(response(completion(raw)));
            const result = await generateStoryArchiveDelta(entry, messages, api, 1, 'summary');
            expect(result.facts.map(fact => fact.key)).toEqual(['阿泽/承诺']);
            expect(result.summary).toContain('阿泽答应陪小雨走回家。');
            const request = JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content as string;
            expect(request).toContain('阿泽是医生。');
            expect(request).toContain('医院夜间关闭。');
            expect(request).not.toContain('秘密飞船会在天亮前出现');
            expect(fetchMock).toHaveBeenCalledTimes(1);
        } finally {
            originalCharacters.mockRestore();
            originalBooks.mockRestore();
        }
    });
    it('keeps changes to an existing role state even when the original state is in the role card', () => {
        const known = [{ key: '阿泽/职业', kind: 'fact' as const, text: '阿泽是医生。',
            terms: ['阿泽'], sourceMessageId: 1 }];
        const sources = new Map([[3, { text: '阿泽已经从医院辞职。', authorInput: false }]]);
        const raw = JSON.stringify({ changes: [{
            action: 'update', kind: 'fact', key: '阿泽/职业', text: '阿泽已辞去医生工作。',
            terms: ['阿泽'], sourceMessageId: 3,
        }] });
        expect(parseStoryArchiveChanges(raw, sources, known, '【阿泽】\n人物档案：阿泽是医生。'))
            .toEqual([expect.objectContaining({ key: '阿泽/职业', text: '阿泽已辞去医生工作。' })]);
    });
    it('recalls plot-specific archived vector facts with local BM25 when semantic API is off', async () => {
        const node = (id: string, content: string) => ({
            id, charId: storyTheaterThreadId(entry.id), room: 'living_room' as const,
            content, tags: ['剧情'], mood: 'neutral', importance: 6, embedded: true,
            createdAt: 1, lastAccessedAt: 1, accessCount: 0,
        });
        const recalled = await selectStoryVectorRecall(
            { nodes: [], groups: [] },
            ['刚才天气怎么样', '铜钥匙放在哪里'],
            undefined,
            [node('weather', '今天一直在下雨。'.repeat(1200)), node('key', '铜钥匙藏在钟楼的第三阶。')],
        );
        expect(recalled.semanticFactRank.has('key')).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
        const full = await selectStoryVectorRecall(
            { nodes: [], groups: [] }, '钥匙', { baseUrl: 'https://embedding.invalid/v1', apiKey: 't', model: 'test', dimensions: 3 },
            [node('key', '铜钥匙藏在钟楼的第三阶。')],
        );
        expect(full.semanticFactRank.size).toBe(0);
        expect(fetchMock).not.toHaveBeenCalled(); // All facts fit: inject directly, no extra Embedding cost
    });
    it('looks up related old vector records locally before a summary when references overflow', async () => {
        const charId = storyTheaterThreadId(entry.id);
        const node = { id: 'original-permit', charId, room: 'living_room' as const, mood: 'neutral' as const,
            content: '准入凭证由第一班值班员保管，交柜台验签后方可进入。', tags: [], importance: 6,
            embedded: true, createdAt: 1, lastAccessedAt: 1, accessCount: 0 };
        await MemoryNodeDB.save(node);
        await MemoryVectorDB.save({memoryId:node.id,charId,vector:[1,0,0],dimensions:3,model:'vector'});
        const facts = [{key:'旧关卡/通行规则',kind:'fact' as const,text:node.content,terms:[],sourceMessageId:1,vectorNodeId:node.id}];
        const distractors = Array.from({length:90},(_,index)=>({
            key:'交接/物资'+index, kind:'fact' as const,
            text:('雨棚内的交接表由当班站务登记，待分配的箱子在防雨货架。').repeat(5)+index,
            terms:['交接'], sourceMessageId:index+2,
        }));
        const story = {...entry, archives:[
            {id:'permit',strategy:'vector' as const,createdAt:1,messageCount:1,fromMessageId:1,toMessageId:1,vectorMemoryIds:[node.id],facts},
            {id:'unrelated',strategy:'summary' as const,createdAt:2,messageCount:90,fromMessageId:2,toMessageId:91,facts:distractors},
        ]};
        const message = {...messages[0],id:200,content:'准入凭证应该交给谁验签？'};
        fetchMock.mockReset().mockImplementation(async (url,init)=>{
            expect(String(url)).toMatch(/\/chat\/completions$/);
            const body=JSON.parse(String(init.body));
            expect(body.messages[1].content).toContain('旧关卡/通行规则');
            expect(body.messages[1].content).toContain(node.content);
            return response(completion('{"changes":[]}'));
        });
        const delta = await generateStoryArchiveDelta(story,[message],api,92,'vector');
        expect(delta.facts).toEqual([]);
        expect(fetchMock.mock.calls.map(([url])=>String(url).split('/').at(-1))).toEqual(['completions']);
    });

    it('uses vector ranking when the actual prose budget fills below the old 6000-character gate', async () => {
        const charId = storyTheaterThreadId(entry.id);
        const text = '准入凭证归值班员保管，离开时须交还柜台，并在登记簿签字。凭证必须封存，未经登记不得转交旁人。';
        const important = { id: 'old-permit', charId, room: 'living_room' as const, mood: 'neutral' as const,
            content: text, tags: [], importance: 6, embedded: true, createdAt: 1, lastAccessedAt: 1, accessCount: 0 };
        const nodes = [important, ...Array.from({ length: 62 }, (_, index) =>
            ({ ...important, id: 'other-' + index, content: '普通日常记录。'.repeat(7) + index }))];
        const facts = nodes.map((node, index) => ({ key: node.id, kind: 'fact' as const, text: node.content,
            sourceMessageId: index + 1, vectorNodeId: node.id, terms: [] }));
        const query = '怎样才能获准进去？';
        const floorNumbers = new Map(facts.map(fact => [fact.sourceMessageId, fact.sourceMessageId]));
        expect(storyArchiveNeedsRanking(facts, floorNumbers, new Map())).toBe(true);
        expect(nodes.reduce((count, node) => count + node.content.length, 0)).toBeLessThan(6000);
        await MemoryNodeDB.save(important);
        await MemoryVectorDB.save({ memoryId: important.id, charId, vector: [1, 0, 0], dimensions: 3, model: 'vector' });
        fetchMock.mockImplementation(async (_url, init) => {
            const request = JSON.parse(String(init.body));
            expect(request.input).toHaveLength(3);
            return response({ data: request.input.map((_:string,index:number)=>({ index, embedding:[1,0,0] })) });
        });
        const signals = ['上一轮的正文', '再之前的推进', query];
        for (let turn=0;turn<3;turn++) {
            const recalled=await selectStoryVectorRecall({nodes:[],groups:[]},signals,
                {baseUrl:'https://vector.invalid/v1',apiKey:'test',model:'vector',dimensions:3},
                nodes,storyArchiveNeedsRanking(facts,floorNumbers,new Map()));
            expect(recalled.semanticFactRank.has(important.id)).toBe(true);
            expect(formatStoryArchiveProseContext(facts,query,floorNumbers,recalled.semanticFactRank)).toContain(text);
        }
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('filters already archived static setup on reading, but keeps corrected states and author instructions', () => {
        const staticFact = { key: '阿泽/身份', kind: 'fact' as const, text: '阿泽是医生。', terms: ['阿泽'], sourceMessageId: 1 };
        const older = { key: '钥匙/主人', kind: 'fact' as const, text: '阿泽拿着钥匙。', terms: ['钥匙'], sourceMessageId: 2 };
        const current = { ...older, sourceMessageId: 4, text: '小雨拿着钥匙。' };
        const author = { key: '写作/不代写', kind: 'author' as const, text: '不得替小雨做重大决定。', terms: ['小雨'], sourceMessageId: 4 };
        const archive = [{
            id: 'a', strategy: 'summary' as const, fromMessageId: 1, toMessageId: 4,
            messageCount: 4, createdAt: 1, facts: [staticFact, older, current, author],
        }];
        const baseline = '【阿泽】\n人物档案：阿泽是医生。\n世界书：小雨拿着钥匙。';
        const filtered = filterStoryArchiveBaselineRepeats([staticFact, current, author], archive, baseline);
        expect(filtered.map(fact => fact.key)).toEqual(['钥匙/主人', '写作/不代写']);
        expect(filterStoryArchiveBaselineRepeats([staticFact], [], '')).toHaveLength(1);
        expect(archive[0].facts).toHaveLength(4); // Read-only; never delete user archives
    });
    it('strips legacy Tavern title comments before sending the actual opening', async () => {
        const opening = { ...messages[0], content: '<!-- title:第一幕 -->\n<!-- desc:雨夜。 -->\n{{char}}走进车站。',
            metadata: { ...messages[0].metadata, theaterOpeningGreeting: { characterId: 'actor', greetingId: 'opening' } } } as Message;
        await generateStoryArchiveDelta(entry, [opening, messages[1]], api, 1, 'summary');
        const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(payload.messages[1].content).toContain('{{char}}走进车站。');
        expect(payload.messages[1].content).not.toContain('<!-- title:');
        expect(payload.messages[1].content).not.toContain('先计划情节');
    });
    it('does not offer a continue-button control as quotable plot evidence', async () => {
        const control = { ...messages[0], content: '继续生成；此句不是剧情设定。',
            metadata: { ...messages[0].metadata, theaterContinue: true } } as Message;
        fetchMock.mockResolvedValueOnce(response(completion(JSON.stringify({ changes: [{
            action: 'add', key: '阿泽/承诺', kind: 'fact', text: '阿泽答应陪小雨回家。',
            terms: ['阿泽', '小雨'], sourceMessageId: messages[1].id, quote: '阿泽答应陪小雨走回家。',
        }] }))));
        const result = await generateStoryArchiveDelta(entry, [control, messages[1]], api, 1, 'summary');
        const input = JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content as string;
        expect(input).toContain('续写操作（无新事实，不作为来源）');
        expect(input).not.toContain('继续生成；此句不是剧情设定。');
        expect(input).not.toContain('记录ID ' + control.id + ']');
        expect(result.facts).toEqual([expect.objectContaining({ sourceMessageId: messages[1].id })]);
        expect(fetchMock).toHaveBeenCalledOnce();
    });
    it('uses the configured save ceiling without truncation or another model request', async () => {
        expect(STORY_ARCHIVE_DEFAULT_GUIDE_MAX_CHARS).toBe(1500);
        expect(normalizeStoryArchiveGuideMaxChars(undefined)).toBe(1500);
        const longFact = '具体信息。'.repeat(250);
        fetchMock.mockImplementation(async (_url, init) => response(structured(longFact, init)));
        const saved = await generateStoryArchiveDelta(entry, messages, api, 1, 'summary');
        expect(saved.summary).toBe('[第 1 楼] ' + longFact);
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('max_tokens');
        await expect(generateStoryArchiveDelta({ ...entry, archiveSummaryGuideMaxChars: 1200 },
            messages, api, 1, 'summary')).rejects.toThrow('1200');
        fetchMock.mockImplementationOnce(async (_url, init) => response(structured(longFact + '正文'.repeat(140), init)));
        await expect(generateStoryArchiveDelta(entry, messages, api, 1, 'summary')).rejects.toThrow('1500');
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });
    it('checks guaranteed affinity receipts before calling and preserves them on success', async () => {
        const row = { ...messages[0], metadata: { ...messages[0].metadata,
            theaterAffinityInputs: [{ characterId: 'a', characterName: '阿泽', delta: 4, awareness: 'unnoticed', reason: '等我回家' }] } } as Message;
        await expect(generateStoryArchiveDelta({ ...entry, archiveSummaryGuideMaxChars: 1 },
            [row, messages[1]], api, 5, 'summary')).rejects.toThrow('本次未调用');
        expect(fetchMock).not.toHaveBeenCalled();
        const saved = await generateStoryArchiveDelta(entry, [row, messages[1]], api, 5, 'summary');
        expect(saved.affinityLog.join('\n')).toContain('第 5 楼 · 阿泽 · 用户对角色 · +4 · 未告知角色 · 原因：等我回家');
    });
    it('finishes one paid summary when the gateway sends DONE without a newline or closing the stream', async () => {
        let cancelled = false;
        fetchMock.mockImplementationOnce(async (_url, init) => {
            const content = structured('车站关门了。', init).choices[0].message.content;
            const frames = 'data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\ndata: [DONE]';
            return new Response(new ReadableStream({
                start(controller) { controller.enqueue(new TextEncoder().encode(frames)); },
                cancel() { cancelled = true; },
            }), { headers: { 'Content-Type': 'text/event-stream' } });
        });
        const saved = await generateStoryArchiveDelta(entry, messages, api, 1, 'summary');
        expect(saved.facts[0].text).toBe('车站关门了。');
        expect(cancelled).toBe(true);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('keeps gateway query parameters and reports an HTML 413 as a range limit', async () => {
        const gateway = { ...api, baseUrl: ' \u200Bhttps://llm.invalid/v1/?route=memory&mode=cheap ', model: ' test ' };
        await generateStoryArchiveDelta(entry, messages, gateway, 1, 'summary');
        expect(fetchMock.mock.calls[0][0]).toBe('https://llm.invalid/v1/chat/completions?route=memory&mode=cheap');
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('test');
        fetchMock.mockResolvedValueOnce(new Response('<html>Request too large</html>', { status: 413 }));
        await expect(generateStoryArchiveDelta(entry, messages, gateway, 1, 'summary')).rejects.toThrow('请缩小范围');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('uses only Content-Type for keyless endpoints and makes no retry on error', async () => {
        await generateStoryArchiveDelta(entry, messages, { ...api, apiKey: '' }, 1, 'summary');
        expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json' });
        fetchMock.mockResolvedValueOnce(new Response('服务不可用', { status: 503 }));
        await expect(generateStoryArchiveDelta(entry, messages, api, 1, 'summary')).rejects.toThrow('服务不可用');
        expect(fetchMock).toHaveBeenCalledTimes(2);
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
        fetchMock.mockImplementationOnce(async (_url, init) => {
            await DB.saveStoryTheater({ ...entry, premise: '另一个窗口编辑的介绍', archives: [...entry.archives, { ...entry.archives[0], id: 'later' }] });
            return response(structured('新摘要', init));
        });
        const result = await regenerate();
        const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(payload.messages[1].content).toContain('阿泽答应陪小雨走回家');
        expect(payload.messages[1].content).not.toContain('先计划情节');
        expect(payload.messages[1].content).not.toContain('盒外');
        expect(payload.messages[1].content).not.toContain('旧摘要');
        expect(payload).toMatchObject({ model: 'test', stream: false });
        expect(payload).not.toHaveProperty('max_tokens');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(result.archives[0]).toMatchObject({ ...entry.archives[0], summary: expect.stringContaining('新摘要'), facts: [expect.objectContaining({ text: '新摘要' })] });
        expect(result.archives).toHaveLength(2);
        expect(result.premise).toBe('另一个窗口编辑的介绍');
        expect((await fresh()).archives[0].summary).toContain('新摘要');
        expect((await DB.getMessagesByCharId(storyTheaterThreadId(entry.id), true)).slice(0, 2)).toEqual(messages);
    });
    it('keeps the old summary on reasoning-only response and unlocks for an explicit retry', async () => {
        fetchMock.mockResolvedValueOnce(response(completion('', 'stop', '只有推理')));
        await expect(regenerate()).rejects.toThrow('思维链');
        expect((await fresh()).archives[0]).toEqual(entry.archives[0]);
        await expect(regenerate()).resolves.toMatchObject({ archives: [{ summary: expect.stringContaining(fixtureSummary) }] });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not replace meaningful memory when the model returns a valid but empty result', async () => {
        fetchMock.mockResolvedValueOnce(response(completion('{"changes":[]}')));
        await expect(regenerate()).rejects.toThrow('旧归档和原文已保留');
        expect(fetchMock).toHaveBeenCalledOnce();
        expect((await fresh()).archives).toEqual(entry.archives);
        expect(await DB.getMessagesByCharId(storyTheaterThreadId(entry.id), true)).toEqual(messages);
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
        fetchMock.mockImplementationOnce(async (_url, init) => {
            if (change === 'summary') await DB.saveStoryTheater({ ...entry, archives: [{ ...entry.archives[0], summary: '其他窗口的新摘要' }] });
            if (change === 'message') await DB.updateMessage(messages[1].id, '已编辑的原文');
            if (change === 'delete') await DB.deleteStoryTheater(entry.id);
            return response(structured('本次旧请求结果', init));
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
        release(response(structured('新摘要', fetchMock.mock.calls[0][1])));
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
        expect(body.messages[0].content).toContain('六项用于检查覆盖');
        expect(body.messages[0].content).toContain('无需输出六个标题');
        expect(body.messages[0].content).toContain('已完成或取消的事只作为过去结果保留');
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
        fetchMock.mockImplementationOnce(async (_url, init) => {
            await DB.updateMessage(third.id, '在另一个窗口修改了这层');
            return response(structured('旧请求生成的摘要', init));
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
        fetchMock.mockImplementationOnce(async (_url, init) => response(structured(summary, init)));
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
        expect([...(await loadStoryVectorRecall(initial, Infinity)).factTextById.values()]).toEqual(['小雨开始信任阿泽。']);
        queueArchive('阿泽把备用钥匙交给小雨，两人成为搭档。');
        const replaced = await archiveStoryFloorRange(entry.id, floors.slice(1), api, oldBox.id, vector);
        expect(replaced.archives).toHaveLength(1);
        expect(replaced.archives[0].summary).toBeUndefined();
        expect(replaced.archives[0].id).toBe(oldBox.id);
        expect(await MemoryNodeDB.getById(oldIds[0])).toBeUndefined();
        expect((await MemoryVectorDB.getAllByCharId(partition())).map(item => item.memoryId)).toEqual(replaced.archives[0].vectorMemoryIds);
        expect((await read()).map(row => !!row.metadata?.theaterArchived)).toEqual([false, true, true]);
        const recall = await loadStoryVectorRecall(replaced, Infinity);
        expect([...recall.factTextById.values()]).toEqual(['阿泽把备用钥匙交给小雨，两人成为搭档。']);
        const revoked = await revokeStoryArchive(entry.id, replaced.archives[0]);
        expect((await selectStoryVectorRecall(await loadStoryVectorRecall(revoked, Infinity), '')).archiveIds.size).toBe(0);
        expect(await MemoryNodeDB.getByCharId(partition())).toEqual([]);
        expect(await MemoryVectorDB.getAllByCharId(partition())).toEqual([]);
        expect((await read()).map(row => !!row.metadata?.theaterArchived)).toEqual([false, false, false]);
        expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('reuses one paid summary on explicit Embedding retry', async () => {
        const floors = (await prepare()).slice(0, 2);
        const run = { completed: new Map<string, string>() };
        fetchMock.mockImplementationOnce(async (_url, init) => response(structured('木盒已经找到。', init)));
        fetchMock.mockResolvedValueOnce(new Response('暂时不可用', { status: 503 }));
        await expect(archiveStoryFloorRange(entry.id, floors, api, undefined, vector, run)).rejects.toThrow('503');
        expect((await fresh()).archives).toEqual([]);
        fetchMock.mockResolvedValueOnce(response({ data: [{ index: 0, embedding: [1, 0, 0] }] }));
        await expect(archiveStoryFloorRange(entry.id, floors, api, undefined, vector, run)).resolves.toBeDefined();
        expect(fetchMock.mock.calls.map(([url]) => url.split('/').at(-1))).toEqual(['completions', 'embeddings', 'embeddings']);
    });

    it('preserves the indexed vector and floor flags when a replacement returns an empty summary', async () => {
        const floors = (await prepare()).slice(0, 2);
        queueArchive('小雨还拿着备用钥匙。');
        const initial = await archiveStoryFloorRange(entry.id, floors, api, undefined, vector);
        const box = initial.archives[0];
        const archivedRows = await read();
        const run = { completed: new Map<string, string>() };
        fetchMock.mockClear();
        fetchMock.mockResolvedValueOnce(response(completion('{"changes":[]}')));
        await expect(archiveStoryFloorRange(entry.id, floors, api, box.id, vector, run))
            .rejects.toThrow('旧归档和原文已保留');
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(run.completed.size).toBe(0);
        expect((await fresh()).archives).toEqual([box]);
        expect((await MemoryVectorDB.getAllByCharId(partition())).map(item => item.memoryId)).toEqual(box.vectorMemoryIds);
        expect(await read()).toEqual(archivedRows);
    });

    it.each(['malformed', 'provider'])('stops after the first bad Embedding batch (%s), reusing successful work', async kind => {
        const floors = (await prepare()).slice(0, 2);
        const run = { completed: new Map<string, string>(), indexedBatches: new Map<string, Float32Array[]>(), onProgress: vi.fn() };
        const changes = Array.from({ length: 23 }, (_, i) => ({
            key: '线索/事件' + i, kind: 'fact', action: 'add', text: '巡逻员登记了不同地点的线索' + i + '。',
            sourceMessageId: floors[0].id,
        }));
        fetchMock.mockResolvedValueOnce(response(completion(JSON.stringify({ changes }))));
        const numbers: number[] = [];
        fetchMock.mockImplementation(async (_url, init) => {
            const input = JSON.parse(String(init.body)).input as string[];
            const i = Number(input[0].match(/(\d+)。$/u)?.[1]);
            numbers.push(i);
            if (numbers.length === 2) return kind === 'provider'
                ? new Response('quota limit', { status: 429 }) : response({ data: [] });
            return response({ data: input.map((_, index) => ({ index, embedding: [1, 0, 0] })) });
        });
        await expect(archiveStoryFloorRange(entry.id, floors, api, undefined, vector, run)).rejects.toThrow();
        expect(numbers).toEqual([0, 10]);
        expect((await fresh()).archives).toEqual([]);
        expect(run.indexedBatches.size).toBe(1);
        const saved = await archiveStoryFloorRange(entry.id, floors, api, undefined, vector, run);
        expect(numbers).toEqual([0, 10, 10, 20]);
        expect(saved.archives[0].vectorMemoryIds).toHaveLength(23);
        expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/chat/completions'))).toHaveLength(1);
    });

    it('does not spend on a new summary when the prior attempt is stale on retry', async () => {
        const floors = (await prepare()).slice(0, 2);
        const run = { completed: new Map<string, string>() };
        fetchMock.mockImplementationOnce(async (_url, init) => response(structured('木盒已经找到。', init)));
        fetchMock.mockResolvedValueOnce(new Response('retry later', { status: 503 }));
        await expect(archiveStoryFloorRange(entry.id, floors, api, undefined, vector, run)).rejects.toThrow('503');
        await DB.saveStoryTheater({ ...await fresh(), title: '另一窗口的新标题' });
        await expect(archiveStoryFloorRange(entry.id, floors, api, undefined, vector, run))
            .rejects.toThrow('本次未重新调用');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('rejects a deterministic invalid Embedding endpoint before incurring a summary call', async () => {
        const floors = (await prepare()).slice(0, 2);
        await expect(archiveStoryFloorRange(entry.id, floors, api, undefined, {
            embedding: { ...vector.embedding, baseUrl: 'https://vector.invalid/v1/embeddings' },
        })).rejects.toThrow('本次未调用总结 API');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('can archive with an imported Embedding URL containing edge whitespace and a gateway query', async () => {
        const floors = (await prepare()).slice(0, 2);
        queueArchive('备用钥匙收在木盒。');
        const saved = await archiveStoryFloorRange(entry.id, floors, api, undefined, {
            ...vector, embedding: { ...vector.embedding, baseUrl: ' \u200Bhttps://vector.invalid/v1/?route=archive ' },
        });
        expect(saved.archives[0].facts).toHaveLength(1);
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
            'https://llm.invalid/v1/chat/completions', 'https://vector.invalid/v1/embeddings?route=archive',
        ]);
    });

    it('keeps archived floors intact if one proposed fact exceeds vector capacity', async () => {
        const floors = await prepare();
        const longText = '剧情信息不可省略。'.repeat(850);
        fetchMock.mockImplementationOnce(async (_url, init) => response(structured(longText, init)));
        await expect(archiveStoryFloorRange(entry.id, floors.slice(0, 2), api, undefined, vector))
            .rejects.toThrow('1500 字符保存上限');
        expect((await fresh()).archives).toEqual([]);
        expect((await read()).map(row => row.content)).toEqual(floors.map(row => row.content));
        expect(fetchMock).toHaveBeenCalledOnce();
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
        const snapshot = { ...first, archives: [{ ...first.archives[0], vectorMemoryIds: [firstId, secondId], facts: undefined }] };
        const recall = await selectStoryVectorRecall(await loadStoryVectorRecall(snapshot, Infinity), '');
        expect(recall.text).toContain('旧'.repeat(5900));
        expect(recall.text).toContain('变化'.repeat(70));
        expect(recall.archiveIds.size).toBe(1);
    });

    it('only sends a separate query embedding when saved ranges compete for the recall window', async () => {
        const floors = await prepare();
        queueArchive('先在站台碰面。');
        const first = await archiveStoryFloorRange(entry.id, floors.slice(0, 2), api, undefined, vector);
        queueArchive('后来去了旅馆。');
        const second = await archiveStoryFloorRange(entry.id, floors.slice(2), api, undefined, vector);
        const source = await loadStoryVectorRecall(second, Infinity);
        expect(source.factNodes).toHaveLength(2);
        await selectStoryVectorRecall(source, '钥匙在哪里？', vector.embedding, source.factNodes);
        expect(fetchMock).toHaveBeenCalledTimes(4);
        for (const box of [first.archives[0], second.archives[1]]) {
            const node = (await MemoryNodeDB.getById(box.vectorMemoryIds![0]))!;
            await MemoryNodeDB.save({ ...node, content: node.content + '细节'.repeat(1600) });
        }
        fetchMock.mockResolvedValueOnce(response({ data: [{ index: 0, embedding: [1, 0, 0] }] }));
        const competing = await loadStoryVectorRecall(second, Infinity);
        const selected = await selectStoryVectorRecall(competing, '钥匙在哪里？', vector.embedding, competing.factNodes);
        expect(selected.semanticFactRank.size).toBeGreaterThan(0);
        expect(fetchMock).toHaveBeenCalledTimes(5);
        expect(fetchMock.mock.calls[4][1].__sullyMeta.purpose).toBe('剧情独立向量 · 续写召回');
    });

    it('keeps the previous range and vectors if replacement embedding fails', async () => {
        const floors = await prepare();
        queueArchive('旧向量内容');
        const initial = await archiveStoryFloorRange(entry.id, floors.slice(0, 2), api, undefined, vector);
        fetchMock.mockImplementationOnce(async (_url, init) => response(structured('新向量内容', init)));
        fetchMock.mockResolvedValueOnce(response({ data: [] }));
        await expect(archiveStoryFloorRange(entry.id, floors.slice(1), api, initial.archives[0].id, vector)).rejects.toThrow();
        expect((await fresh()).archives).toEqual(initial.archives);
        expect((await read()).map(row => !!row.metadata?.theaterArchived)).toEqual([true, true, false]);
        expect([...(await loadStoryVectorRecall(initial, Infinity)).factTextById.values()]).toEqual(['旧向量内容']);
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
        expect((await loadStoryVectorRecall(withLegacy, Infinity)).nodes).toHaveLength(1);
        const revoked = await revokeStoryArchive(entry.id, legacy[0]);
        expect(revoked.archives).toEqual(newer.archives);
        expect((await loadStoryVectorRecall(revoked, Infinity)).factNodes.map(node => node.id)).toEqual([ownedId]);
        expect(await MemoryNodeDB.getById('legacy-node')).toBeUndefined();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});

describe('consecutive automatic archives', () => {
    const embedding = { baseUrl: 'https://vector.invalid/v1', apiKey: 'test', model: 'test-vector', dimensions: 3 };
    const append = async (content: string, role: Message['role'] = 'assistant') => {
        const row = { charId: storyTheaterThreadId(entry.id), role, type: 'text' as const, content, timestamp: 10,
            metadata: { source: 'story_theater', theaterId: entry.id } };
        return { ...row, id: await DB.saveMessage(row) };
    };
    const change = (action: 'add' | 'update', key: string, text: string, row: Message, terms = ['钥匙']) => ({
        action, key, kind: 'fact', text, terms, sourceMessageId: row.id, quote: row.content,
    });
    const queue = (changes: unknown[]) => fetchMock.mockResolvedValueOnce(response(completion(JSON.stringify({ changes }))));
    const queueEmbedding = () => fetchMock.mockImplementationOnce(async (_url, init) => response({
        data: JSON.parse(init.body).input.map((_part: string, index: number) => ({ index, embedding: [1, 0, 0] })),
    }));
    const saveSummary = async (snapshot: StoryTheaterEntry, row: Message, floor: number) => {
        const delta = await generateStoryArchiveDelta(snapshot, [row], api, floor, 'summary');
        return commitStoryArchiveBatch(snapshot, [row], {
            id: 'delta-' + row.id, strategy: 'summary', fromMessageId: row.id, toMessageId: row.id,
            messageCount: 1, createdAt: floor, ...delta,
        });
    };

    it('stores only new events and changed state, leaves a repeat empty, and reads the newest state', async () => {
        const original = await append('小林保管铜钥匙。');
        queue([change('add', '铜钥匙/持有人', original.content, original)]);
        const first = await saveSummary(await fresh(), original, 3);

        const repeated = await append('阿岚提起小林还在保管铜钥匙。');
        // A weak model repeats the exact fact under a different key.
        queue([change('add', '旧钥匙/保管人', original.content, repeated)]);
        const second = await saveSummary(first, repeated, 4);
        expect(second.archives.at(-1)?.facts).toEqual([]);

        const transfer = await append('小林把铜钥匙交给阿岚。');
        const discovery = await append('阿岚确认铜钥匙可以打开钟楼。');
        queue([
            change('update', '铜钥匙/持有人', '铜钥匙现在由阿岚保管。', transfer),
            change('add', '铜钥匙/用途', discovery.content, discovery, ['铜钥匙', '钟楼']),
        ]);
        const delta = await generateStoryArchiveDelta(second, [transfer, discovery], api, 5, 'summary');
        expect(delta.summary).toBe('[第 5 楼] 铜钥匙现在由阿岚保管。\n[第 6 楼] 阿岚确认铜钥匙可以打开钟楼。');
        const updated = await commitStoryArchiveBatch(second, [transfer, discovery], {
            id: 'updated', strategy: 'summary', fromMessageId: transfer.id, toMessageId: discovery.id,
            messageCount: 2, createdAt: 5, ...delta,
        });
        const input = JSON.parse(fetchMock.mock.calls.at(-1)![1].body).messages[1].content;
        expect(input).toContain('"key":"铜钥匙/持有人","kind":"fact","text":"小林保管铜钥匙。"');
        expect(input.split('本批新楼层')[1]).not.toContain(original.content);

        const facts = collectStoryArchiveFacts((await fresh()).archives, Infinity, new Map());
        const selected = formatStoryArchiveFacts(rankStoryArchiveFacts(facts, '拿着钥匙去钟楼'), new Map([
            [transfer.id, 5], [discovery.id, 6],
        ]));
        expect(selected).toBe('[第 6 楼] 阿岚确认铜钥匙可以打开钟楼。\n[第 5 楼] 铜钥匙现在由阿岚保管。');
        expect(collectStoryArchiveFacts(updated.archives, transfer.id, new Map()).map(fact => fact.text)).toEqual([original.content]);
        expect(updated.archives[0]).toEqual(entry.archives[0]);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('carries the previous archive into one request, keeps an event together, and separates distinct author directions with colliding keys', async () => {
        const previousDirection = await append('OOC: 禁止替玩家回答。', 'user');
        const oldResult = await append('阿岚已经把信交给小林。');
        const previous = {
            id:'prior', strategy:'summary' as const, fromMessageId:previousDirection.id, toMessageId:oldResult.id,
            messageCount:2, createdAt:1, facts:[
                { key:'场外/代写', kind:'author' as const, text:'禁止替玩家回答。', terms:[], sourceMessageId:previousDirection.id },
                { key:'信/交付', kind:'fact' as const, text:oldResult.content, terms:['信'], sourceMessageId:oldResult.id, continuity:'completed' as const },
            ],
        };
        await DB.saveStoryTheater({ ...entry, archives:[...entry.archives, previous] });
        const nextDirection = await append('OOC: 禁止替玩家回答。用第三人称。身份须由玩家亲口说出才可确认。只限本轮省略天气。', 'user');
        const nextResult = await append('他们提起之前送到的信。阿岚原本打算走正门，因为正门锁死，最后从暗门送到了铜匣。');
        const summary = '阿岚原计划经正门，因门锁死改走暗门，最后把铜匣送达。';
        const direction = (text: string, authorScope?: string) => ({
            action:'add', key:'作者/要求', kind:'author', sourceMessageId:nextDirection.id, text, authorScope,
        });
        queue([
            direction('禁止替玩家回答。'), direction('使用第三人称。'),
            direction('仅在玩家亲口说出后，旁人才能确认其身份。'), direction('只限本轮省略天气。','turn'),
            { action:'add', key:'信/交付', kind:'fact', text:'阿岚计划交信给小林。', sourceMessageId:nextResult.id,
                modality:'planned', quote:'他们提起之前送到的信。' },
            { action:'add', key:'铜匣/交付', kind:'fact', text:summary, sourceMessageId:nextResult.id,
                continuity:'completed', quote:'阿岚原本打算走正门，因为正门锁死，最后从暗门送到了铜匣。' },
        ]);
        queueEmbedding();
        const result = await archiveStoryFloorRange(entry.id, [nextDirection, nextResult], api, undefined, { embedding });
        const request = JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content as string;
        const priorSection = request.split('上一次已保存归档')[1].split('更早结构化记忆')[0];
        expect(priorSection).toContain('禁止替玩家回答。');
        expect(priorSection).toContain('"continuity":"completed"');
        expect(request.split('本批新楼层')[1]).toContain('有明确场外标记');
        const saved = result.archives.at(-1)!;
        expect(saved.facts?.map(fact => fact.text)).toEqual([
            '使用第三人称。', '仅在玩家亲口说出后，旁人才能确认其身份。', '只限本轮省略天气。', summary,
        ]);
        expect(saved.facts?.at(-1)?.continuity).toBe('completed');
        expect(storyArchiveModality(saved.facts!.at(-1)!)).toBeUndefined();
        expect(JSON.parse(fetchMock.mock.calls[1][1].body).input).toEqual([
            '使用第三人称。', '仅在玩家亲口说出后，旁人才能确认其身份。', summary,
        ]);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(result.archives.find(box => box.id === previous.id)).toEqual(previous);
        const recollected = collectStoryArchiveFacts(result.archives, Infinity, (await loadStoryVectorRecall(result, Infinity)).factTextById);
        const payload = formatStoryArchiveProseContext(recollected, '铜匣');
        expect(payload).toContain(summary);
        expect(payload).not.toContain('只限本轮省略天气。');
    });

    it('keeps the confirmed outcome beside a newer rumor when summarizing the next range', async () => {
        const delivery = await append('阿岚把信交给小林，小林已签收。');
        const rumor = await append('听说那封信还没送到。');
        const done = { key: '信/交付', kind: 'fact' as const, text: delivery.content, terms: ['信'],
            sourceMessageId: delivery.id, continuity: 'completed' as const };
        const uncertain = { key: done.key, kind: done.kind, text: rumor.content, terms: done.terms,
            sourceMessageId: rumor.id, modality: 'unverified' as const };
        const prior = { id: 'settled', strategy: 'summary' as const, fromMessageId: delivery.id,
            toMessageId: rumor.id, messageCount: 2, createdAt: 1, facts: [uncertain], historyFacts: [done] };
        await DB.saveStoryTheater({ ...entry, archives: [...entry.archives, prior] });
        const recap = await append('两人提起此前送信的打算。');
        queue([{ action: 'add', key: done.key, kind: 'fact', text: '阿岚打算送信给小林。',
            modality: 'planned', sourceMessageId: recap.id }]);
        const result = await archiveStoryFloorRange(entry.id, [recap], api);
        const request = JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content as string;
        const previous = request.split('上一次已保存归档')[1].split('更早结构化记忆')[0];
        expect(previous).toContain(delivery.content);
        expect(previous).toContain(rumor.content);
        expect(result.archives.at(-1)?.facts).toEqual([]);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('points out mixed unmarked writing requests in the one summary request and keeps fictional quoted commands as source dialogue', async () => {
        const mixed = await append('我推开栅栏。接下来的正文不要让巡检员知道真名，除非青灯亲口告诉巡检员。', 'user');
        const ordinary = await append('我走到门边，听见巡检员说：“以后不要让他走。”', 'user');
        const ending = await append('巡检员只看见门口的灯。');
        const turn = await append('这一轮只略过天气。', 'user');
        const saved = await append('月亮挂在檐外。');
        queue([{ action:'add', kind:'author', key:'场外/知情限定', text:'巡检员须经青灯亲口告知才知道真名。',
            sourceMessageId:mixed.id }, { action:'add', kind:'author', key:'场外/节奏', text:'仅在本轮回复略过天气。', sourceMessageId:turn.id }]);
        const result = await archiveStoryFloorRange(entry.id, [mixed, ordinary, ending, turn, saved], api);
        const request = JSON.parse(fetchMock.mock.calls[0][1].body);
        const lines = request.messages[1].content.split('\n');
        expect(lines.find((line: string) => line.endsWith('记录ID ' + mixed.id + ']'))).toContain('可能夹有写作要求');
        expect(lines.find((line: string) => line.endsWith('记录ID ' + turn.id + ']'))).toContain('可能夹有写作要求');
        expect(lines.find((line: string) => line.endsWith('记录ID ' + ordinary.id + ']'))).not.toContain('可能夹有写作要求');
        expect(lines.at(-1)).toContain('记录ID ' + mixed.id + '、' + turn.id);
        expect(lines.at(-1)).not.toContain(ordinary.content);
        expect(result.archives.at(-1)?.facts).toEqual([
            expect.objectContaining({ text:'巡检员须经青灯亲口告知才知道真名。' }),
            expect.objectContaining({ text:'仅在本轮回复略过天气。', authorScope:'turn' }),
        ]);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('rejects nonexistent source IDs and actor dialogue mislabeled as author corrections before saving', async () => {
        const row = await append('阿岚对小林说：“以后不要开门。”');
        queue([{ ...change('add', '钟楼/开门', row.content, row), sourceMessageId: 9999,
            quote: '已经把门封住了' }]);
        await expect(saveSummary(await fresh(), row, 3)).rejects.toThrow('来源无效');
        queue([{ ...change('add', '作者/开门', '以后不要开门。', row), kind: 'author' }]);
        await expect(saveSummary(await fresh(), row, 3)).rejects.toThrow('来源无效');
        expect((await fresh()).archives).toEqual(entry.archives);
        expect((await DB.getMessageById(row.id))?.metadata?.theaterArchived).toBeUndefined();
    });

    it('stores one vector per changed fact, skips embedding empty batches and respects edits and deletions', async () => {
        const original = await append('小林保管铜钥匙。');
        queue([change('add', '铜钥匙/持有人', original.content, original)]);
        queueEmbedding();
        await archiveStoryVectorRangeInGeneration(entry.id, [original], api, { embedding });

        const repeat = await append('他们又提起钥匙。');
        queue([]);
        const empty = await archiveStoryVectorRangeInGeneration(entry.id, [repeat], api, { embedding });
        expect(empty.archives.at(-1)?.vectorMemoryIds).toEqual([]);
        expect(fetchMock).toHaveBeenCalledTimes(3);

        const transfer = await append('小林把铜钥匙交给阿岚。');
        queue([change('update', '铜钥匙/持有人', '阿岚保管铜钥匙。', transfer)]);
        queueEmbedding();
        const updated = await archiveStoryVectorRangeInGeneration(entry.id, [transfer], api, { embedding });
        const id = updated.archives.at(-1)!.vectorMemoryIds![0];
        const readFacts = async () => collectStoryArchiveFacts(updated.archives, Infinity,
            (await loadStoryVectorRecall(updated, Infinity)).factTextById);
        expect((await readFacts()).map(fact => fact.text)).toEqual(['阿岚保管铜钥匙。']);
        expect((await selectStoryVectorRecall(await loadStoryVectorRecall(updated, Infinity), '')).text).toBe('');

        queueEmbedding();
        await updateStoryVectorMemory(entry.id, id, '阿岚把铜钥匙放在书桌。', embedding);
        expect((await readFacts()).map(fact => fact.text)).toEqual(['阿岚把铜钥匙放在书桌。']);
        const calls = fetchMock.mock.calls.length;
        await expect(updateStoryVectorMemory(entry.id, id, '过期草稿。', embedding, undefined, '阿岚保管铜钥匙。'))
            .rejects.toThrow('已在别处修改');
        await expect(deleteStoryVectorMemory(entry.id, id, undefined, '阿岚保管铜钥匙。')).rejects.toThrow('已在别处修改');
        expect(fetchMock).toHaveBeenCalledTimes(calls);
        expect((await readFacts()).map(fact => fact.text)).toEqual(['阿岚把铜钥匙放在书桌。']);
        const edited = (await MemoryNodeDB.getById(id))!;
        // A missing local node still sends the user's latest edit from the archive.
        await MemoryNodeDB.delete(id);
        expect((await readFacts()).map(fact => fact.text)).toEqual(['阿岚把铜钥匙放在书桌。']);
        await MemoryNodeDB.save(edited);
        await deleteStoryVectorMemory(entry.id, id);
        expect(await readFacts()).toEqual([]);
    });
});

describe('long story archives process small consecutive requests', () => {
    const sample = new Map([
        [4, { key: '铜钥匙/刻字', text: '铜钥匙上刻着 17。' }],
        [12, { key: '铜钥匙/持有人', text: '小林保管铜钥匙。' }],
        [18, { key: '铜钥匙/持有人', text: '小林保管铜钥匙。' }],
        [24, { key: '备用钥匙/藏处', text: '备用钥匙藏在钟楼第三阶。' }],
        [36, { key: '钟楼/通行条件', text: '下雨时不能从东门进钟楼。' }],
        [50, { key: '钟楼暗号/小林知情', text: '暗号是「蓝雨」，只有小林知道。' }],
        [60, { key: '钟楼/开门时间', text: '钟楼要到午夜才开门。' }],
        [70, { key: '铜钥匙/持有人', text: '铜钥匙改由阿岚保管。' }],
    ]);
    const saveLongStory = async () => {
        const floors: Message[] = [];
        const charId = storyTheaterThreadId(entry.id);
        for (let floor = 1; floor <= 72; floor++) {
            const row = { charId, role: floor % 2 ? 'user' as const : 'assistant' as const, type: 'text' as const,
                content: sample.get(floor)?.text ?? '继续调查钟楼。', timestamp: floor,
                metadata: { source: 'story_theater', theaterId: entry.id } };
            floors.push({ ...row, id: await DB.saveMessage(row) });
        }
        return floors;
    };
    const fixture = (floors: Message[], init: RequestInit) => {
        const input = JSON.parse(String(init.body)).messages[1].content as string;
        const ids = [...input.split('本批新楼层\n')[1].matchAll(/记录ID (\d+)\]/g)].map(match => Number(match[1]));
        const changes = ids.flatMap(id => {
            const floor = floors.findIndex(row => row.id === id) + 1;
            const fact = sample.get(floor);
            if (!fact) return [];
            return [{ ...fact, action: floor === 70 ? 'update' : 'add', kind: 'fact',
                terms: ['钟楼', '铜钥匙', '暗号'], sourceMessageId: id, quote: fact.text }];
        });
        return { ids, input, body: completion(JSON.stringify({ changes })) };
    };

    it('archives three sourced facts in one request when the third quote is paraphrased', async () => {
        const floors = await saveLongStory();
        const firstBatch = floors.slice(0, 12);
        const changes = [
            { action: 'add', key: '铜钥匙/刻字', kind: 'fact', text: sample.get(4)!.text,
                terms: ['铜钥匙'], sourceMessageId: firstBatch[3].id, quote: sample.get(4)!.text },
            { action: 'add', key: '铜钥匙/持有人', kind: 'fact', text: sample.get(12)!.text,
                terms: ['小林', '铜钥匙'], sourceMessageId: firstBatch[11].id, quote: sample.get(12)!.text },
            { action: 'add', key: '钟楼/调查', kind: 'fact', text: '众人仍在调查钟楼。',
                terms: ['钟楼'], sourceMessageId: firstBatch[7].id, quote: '大家正在仔细调查钟楼内部。' },
        ];
        fetchMock.mockResolvedValueOnce(response(completion(JSON.stringify({ changes }))));
        const result = await generateStoryArchiveDelta(entry, firstBatch, api, 1, 'summary');
        expect(result.facts).toHaveLength(3);
        expect(result.facts.map(fact => fact.sourceMessageId)).toEqual([
            firstBatch[3].id, firstBatch[7].id, firstBatch[11].id,
        ]);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it.each([
        { name: '截断 JSON', reply: completion('{"changes":[{"key":"截断"') },
        { name: '输出截断', reply: completion('{"changes":[', 'length') },
    ])('长篇归档遇到 $name 时只发一次，不拆楼重试，保留旧归档', async ({ reply }) => {
        const floors = await saveLongStory();
        const rows = floors.map(row => ({ ...row, content: row.content + '其余正文。'.repeat(980) }));
        fetchMock.mockResolvedValue(response(reply));
        const progress = vi.fn();
        await expect(generateStoryArchiveDelta(entry, rows, api, 22, 'summary', undefined, { onProgress: progress })).rejects.toThrow();
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fixture(rows, fetchMock.mock.calls[0][1]).ids).toEqual(rows.map(row => row.id));
        expect(progress.mock.calls).toEqual([[{ phase: 'summary', first: 22, last: 93, requesting: true }]]);
        expect((await fresh()).archives).toEqual(entry.archives);
    });

    it('reports the upstream input limit and stops instead of paying for smaller follow-up requests', async () => {
        const floors = await saveLongStory();
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'bad request', code: 'context_length_exceeded' } }), { status: 400 }));
        await expect(archiveStoryFloorRange(entry.id, floors, api)).rejects.toThrow('所选楼层超出总结接口容量');
        expect(fetchMock).toHaveBeenCalledOnce();
        expect((await fresh()).archives).toEqual(entry.archives);
    });

    it.each(['manual', 'automatic', 'regenerate', 'vector'] as const)(
        'extracts 36 rounds in one summary request via %s and stores individual sourced facts', async mode => {
            const floors = await saveLongStory();
            if (mode === 'regenerate') {
                entry.archives.push({ id: 'long-box', strategy: 'summary', fromMessageId: floors[0].id,
                    toMessageId: floors.at(-1)!.id, messageCount: floors.length, createdAt: 2, summary: '旧的一次性摘要' });
                await DB.saveStoryTheater(entry);
            }
            const ranges: number[][] = [];
            const inputs: string[] = [];
            fetchMock.mockImplementation(async (url, init) => {
                if (String(url).endsWith('/embeddings')) {
                    const texts = JSON.parse(String(init.body)).input as string[];
                    expect(texts).toContain(sample.get(50)?.text);
                    expect(texts).not.toContain(sample.get(12)?.text);
                    return response({ data: texts.map((_, index) => ({ index, embedding: [1, 0, 0] })) });
                }
                const { ids, input, body } = fixture(floors, init);
                ranges.push(ids);
                inputs.push(input);
                return response(body);
            });

            const result = mode === 'regenerate'
                ? await regenerateStoryArchiveSummary(entry.id, 'long-box', api)
                : mode === 'automatic'
                    ? await generateStoryArchiveDelta(entry, floors, api, 3, 'summary')
                    : await archiveStoryFloorRange(entry.id, floors, api, undefined, mode === 'vector' ? {
                        embedding: { baseUrl: 'https://vector.invalid/v1', apiKey: 'test', model: 'test', dimensions: 3 },
                    } : undefined);
            expect(ranges.map(ids => ids.length)).toEqual([72]);
            expect(ranges.flat()).toEqual(floors.map(row => row.id));
            expect(inputs[0]).toContain('小林保管铜钥匙。');
            const archive = 'archives' in result ? result.archives.at(-1)! : result;
            expect(archive.facts?.map(fact => [fact.sourceMessageId, fact.text])).toEqual(
                [4, 24, 36, 50, 60, 70].map(floor => [floors[floor - 1].id, sample.get(floor)?.text]),
            );
            if ('archives' in result) {
                const reloaded = await fresh();
                const vector = await loadStoryVectorRecall(reloaded, Infinity);
                const facts = collectStoryArchiveFacts(reloaded.archives, Infinity, vector.factTextById);
                expect(facts.find(fact => fact.key === '钟楼暗号/小林知情')?.text).toBe(sample.get(50)?.text);
            }
            expect(fetchMock).toHaveBeenCalledTimes(mode === 'vector' ? 2 : 1);
        },
    );

    it('player simulation: 91 floors, one summary request, A-to-B-to-C, one current state and historical provenance', async () => {
        // This fixture normally starts with an old two-floor box. A player's
        // fresh 91-floor story must instead begin at floor one.
        for (const row of messages) await DB.deleteMessage(row.id);
        entry.archives = [];
        await DB.saveStoryTheater(entry);
        const floorTexts = new Map([
            [3, '第一天傍晚，林星正在保管铜钥匙。'],
            [7, '当晚，林星把铜钥匙交给阿泽。'],
            [16, '第二天清晨，阿泽把铜钥匙交回林星。'],
            [42, '第三天深夜，林星将铜钥匙交给小雨。'],
            [75, '小雨终于打开了钟楼的密门。'],
        ]);
        const floors: Message[] = [];
        for (let floor = 1; floor <= 91; floor++) {
            const content = floorTexts.get(floor) ?? ('正在继续调查，场景段落 ' + floor);
            const row = { charId: storyTheaterThreadId(entry.id), role: floor % 2 ? 'user' as const : 'assistant' as const,
                type: 'text' as const, content, timestamp: floor,
                metadata: { source: 'story_theater', theaterId: entry.id } };
            floors.push({ ...row, id: await DB.saveMessage(row) });
        }
        const inputs: string[] = [];
        fetchMock.mockImplementation(async (_url, init) => {
            const input = JSON.parse(String(init.body)).messages[1].content as string;
            inputs.push(input);
            const eventFloors = [3, 7, 16, 42, 75];
            const changes = eventFloors.map(eventFloor => ({
                action: eventFloor === 3 || eventFloor === 75 ? 'add' : 'update',
                kind: 'fact',
                key: eventFloor === 75 ? '钟楼/密门' : '铜钥匙/持有人',
                text: ({
                    3: '铜钥匙由林星保管。', 7: '铜钥匙改由阿泽保管。',
                    16: '铜钥匙重新由林星保管。',
                    42: '铜钥匙现在由小雨保管。', 75: '小雨已打开钟楼密门。',
                } as Record<number, string>)[eventFloor],
                sourceMessageId: floors[eventFloor - 1].id,
                storyTime: eventFloor === 75 ? undefined
                    : ({ 3: '第一天傍晚', 7: '当晚', 16: '第二天清晨', 42: '第三天深夜' } as Record<number, string>)[eventFloor],
                terms: ['铜钥匙', '钟楼'], quote: floorTexts.get(eventFloor),
            }));
            return response(completion(JSON.stringify({ changes })));
        });
        const result = await archiveStoryFloorRange(entry.id, floors.slice(0, 90), api);
        const box = result.archives.at(-1)!;
        expect(inputs).toHaveLength(1);
        expect(inputs[0]).toContain('林星把铜钥匙交给阿泽。');
        expect(inputs[0]).toContain('阿泽把铜钥匙交回林星。');
        expect(box.facts?.map(fact => [fact.key, fact.sourceMessageId])).toEqual([
            ['铜钥匙/持有人', floors[41].id], ['钟楼/密门', floors[74].id],
        ]);
        expect(box.historyFacts?.map(fact => [fact.storyTime, fact.text])).toEqual([
            ['第一天傍晚', '铜钥匙由林星保管。'],
            ['当晚', '铜钥匙改由阿泽保管。'],
            ['第二天清晨', '铜钥匙重新由林星保管。'],
        ]);
        const floorNumbers = new Map(floors.map((row, index) => [row.id, index + 1]));
        const history = formatStoryArchiveTransitions(result.archives, floors[90].id, floorNumbers);
        expect(history).toContain('[第 3 楼 · 剧情时间：第一天傍晚] 铜钥匙由林星保管。');
        expect(history).toContain('[第 7 楼 · 剧情时间：当晚] 铜钥匙改由阿泽保管。');
        expect(history).toContain('[第 16 楼 · 剧情时间：第二天清晨] 铜钥匙重新由林星保管。');
        const current = formatStoryArchiveFacts(
            collectStoryArchiveFacts(result.archives, floors[90].id, new Map()), floorNumbers, 6000, true,
        );
        expect(current).toContain('[第 42 楼 · 剧情时间：第三天深夜] 铜钥匙现在由小雨保管。');
        expect(current).not.toContain('铜钥匙由林星保管。');
        expect(box.summary).toContain('【本段历史变化（非当前状态）】');
        const persisted = await fresh();
        expect(persisted.archives.at(-1)?.historyFacts).toEqual(box.historyFacts);
        const savedRows = await DB.getMessagesByCharId(storyTheaterThreadId(entry.id), true);
        expect(savedRows.find(row => row.id === floors[89].id)?.metadata?.theaterArchived).toBe(true);
        expect(savedRows.find(row => row.id === floors[90].id)?.metadata?.theaterArchived).toBeUndefined();
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('stops on provider failure, keeps old archive and original floors, and makes no extra requests', async () => {
        const floors = await saveLongStory();
        fetchMock.mockResolvedValue(new Response('服务繁忙', { status: 503 }));
        await expect(archiveStoryFloorRange(entry.id, floors, api)).rejects.toThrow('服务繁忙');
        expect(fetchMock).toHaveBeenCalledOnce();
        expect((await fresh()).archives).toEqual(entry.archives);
        const rows = await DB.getMessagesByCharId(storyTheaterThreadId(entry.id), true);
        expect(rows.slice(2)).toEqual(floors);
    });
});


describe('续写前核对已结束的事项和持续设定', () => {
    it('不把出发、计划一半做完和未来记录当成全部结案', () => {
        const plan = { key: '王姨/拜访', kind: 'fact' as const, modality: 'planned' as const, sourceMessageId: 1,
            text: '小雨打算给王姨送橘子和换门锁。', terms: [] };
        const oranges = { key: '拜访/橘子', kind: 'fact' as const, sourceMessageId: 3,
            text: '橘子已经送到王姨手里。', terms: [] };
        const enRoute = { key: '拜访/刚出发', kind: 'fact' as const, sourceMessageId: 2,
            text: '小雨已经出发去给王姨送橘子。', terms: [] };
        const archived = [{ id: 'box', strategy: 'summary' as const, fromMessageId: 1, toMessageId: 3,
            messageCount: 3, createdAt: 1, facts: [plan, oranges, enRoute] }];
        expect(reconcileStoryArchiveContinuity([plan, oranges, enRoute], archived, 4, [
            { id: 8, role: 'assistant', content: '小雨已经把门锁换好了。' },
        ], []).closedPlans).toEqual([]);
        expect(reconcileStoryArchiveContinuity([plan, oranges, enRoute], archived, 10, [], [
            { id: 8, role: 'user', content: '小雨已经把门锁换好了。' },
        ]).closedPlans).toEqual([]);
        expect(reconcileStoryArchiveContinuity([plan, oranges, enRoute], archived, 10, [], [
            { id: 8, role: 'assistant', content: '小雨已经把门锁换好了。' },
        ]).closedPlans).toEqual([plan]);
    });

    it('保存有明确来源的持续设定，不从猜测或角色台词补记', () => {
        const confirmed = '叶澄是鬼魂，普通人看不见他，只有戴戒指的人可以看见他。';
        const facts = parseStoryArchiveChanges('{"changes":[]}', new Map([
            [1, { text: confirmed, authorInput: false }],
            [2, { text: '有人怀疑叶澄是鬼魂。', authorInput: false }],
            [3, { text: '“我想你是鬼魂。”他玩笑道。', authorInput: false }],
        ]), []);
        expect(facts).toHaveLength(1);
        expect(facts[0]).toMatchObject({ continuity: 'rule', text: confirmed, sourceMessageId: 1 });
    });
});


describe('主动回查早期剧情', () => {
    it('keeps a named long segment intact even when its latest scene preview would cut off the exception', async () => {
        const segment = '阿潭抵达北门暗道时，原先通往西库的桥板已断。' +
            '他沿着石壁查看街口、封条、风浪和水位，等水手转身才带着回执进门。'.repeat(16) +
            '但封条一旦破损，此路随即封闭，柳巡也不得放行。';
        const rows = [{ ...messages[0], id: 10, role: 'assistant' as const, content: '未发给模型的原文。' }];
        const fact: StoryArchiveFact = { key: '北门暗道/通行', kind: 'fact', sourceMessageId: 10,
            text: segment, terms: ['阿潭', '北门暗道'] };
        const box = { id: 'long-archive', strategy: 'vector' as const, fromMessageId: 10, toMessageId: 10,
            createdAt: 1, messageCount: 1, vectorMemoryIds: [], facts: [fact] };
        const recall = (continuation: boolean) => buildStoryTheaterRecall({
            entry: { ...entry, archives: [box] }, rows, beforeId: 11, floor: 2, baseline: '', visibleRows: [],
            historyVisible: false, continuation, opening: false, userInput: continuation ? '' : '北门暗道有什么限制？',
            readOriginalEvidence: false,
        });
        for (const continuation of [false, true]) {
            const result = await recall(continuation);
            const payload = result.messages.map(message => message.content).join('\n');
            expect(payload).toContain(segment);
            expect(payload.split(segment)).toHaveLength(2);
            expect(payload).not.toContain(rows[0].content);
            expect(result.receipt.injectedFloors).toEqual([1]);
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('keeps long author conditions and unresolved details whole on hidden-history continuation', async () => {
        const authorText = '用第三人称写北门的每次交涉。' + '涉及通行时逐一保留人物已知的线索和相互矛盾的证词。'.repeat(35)
            + '唯一例外：青灯独白不得向柳巡公开。';
        const planText = '阿潭打算从北门取回信件。' + '等待港口放行后，再用先前留存的纸面证据比对封条。'.repeat(26)
            + '若印痕与原卷不同，暂缓交接。';
        const rows = [10, 11, 12].map(id => ({ ...messages[0], id, role: id === 10 ? 'user' as const : 'assistant' as const,
            content: '隐藏并且不发送的原文。' }));
        const facts: StoryArchiveFact[] = [
            { key: '场外/视角', kind: 'author', sourceMessageId: 10, text: authorText, terms: [] },
            { key: '北门/取信', kind: 'fact', modality: 'planned', sourceMessageId: 11, text: planText, terms: ['北门'] },
            { key: '场外/天气', kind: 'author', authorScope: 'turn', sourceMessageId: 10, text: '本轮不写天气。', terms: [] },
        ];
        const box = { id: 'long-author', strategy: 'summary' as const, fromMessageId: 10, toMessageId: 12,
            createdAt: 1, messageCount: 3, facts };
        const result = await buildStoryTheaterRecall({
            entry: { ...entry, archives: [box] }, rows, beforeId: 13, floor: 4, baseline: '', visibleRows: [],
            historyVisible: false, continuation: true, opening: false, userInput: '', readOriginalEvidence: false,
        });
        const payload = result.messages.map(message => message.content).join('\n');
        expect(payload).toContain(authorText);
        expect(payload).toContain(planText);
        expect(payload).not.toContain('本轮不写天气。');
        expect(payload).not.toContain(rows[0].content);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('从全部隐藏的历史按人物和物件找回早期事件盒，仍受时间边界限制', async () => {
        const boxes = Array.from({ length: 12 }, (_, index) => ({
            id: 'legacy-' + index, strategy: 'summary' as const, fromMessageId: index + 1,
            toMessageId: index + 1, messageCount: 1, createdAt: index,
            summary: index === 0 ? '红玛瑙信物是纪婆婆亲自交付的。'
                : index === 11 ? '纪婆婆未来会公开红玛瑙的真相。' : '另一段城门故事' + index,
        }));
        const recalled = await buildStoryTheaterRecall({
            entry: { ...entry, archives: boxes }, rows: [], beforeId: 12, floor: 12, baseline: '', visibleRows: [],
            historyVisible: false, continuation: false, opening: false, userInput: '纪婆婆给过红玛瑙吗？',
            readOriginalEvidence: true,
        });
        expect(recalled.messages.map(message => message.content).join('\n')).toContain(boxes[0].summary);
        expect(recalled.messages.map(message => message.content).join('\n')).not.toContain(boxes[11].summary);
        expect(recalled.receipt.archiveIds).toContain(boxes[0].id);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('隐藏历史时能从旧档别名跨两层找回事实，并跳过损坏、删除及未来条目', async () => {
        const fact = (key: string, text: string, sourceMessageId: number, extra: Partial<StoryArchiveFact> = {}): StoryArchiveFact =>
            ({ key, kind: 'fact', text, sourceMessageId, terms: [], ...extra });
        const copied = '矿工从东井转移到白桦谷。';
        const deleted = '已删除的蓝色入口位置。';
        const future = '未来的白桦谷约定。';
        const rows = [10, 20, 30, 40, 50].map(id => ({ ...messages[0], id }));
        const box = {
            id: 'old-links', strategy: 'vector' as const, fromMessageId: 10, toMessageId: 40, messageCount: 4,
            createdAt: 1, vectorMemoryIds: [],
            facts: [
                fact('矿工转移', copied, 10),
                fact('山道封锁', '巡守封锁了北侧马道。', 20, { relatedKeys: ['矿工转移', '删掉的地点'] }),
                fact('指路牌', '铜牌又称「冬星」。', 30, { terms: undefined, relatedKeys: ['山道封锁', '未来约定'] }),
                fact('删掉的地点', deleted, 30, { vectorTextState: 'deleted' }),
                ...Array.from({ length: 40 }, (_, i) => fact('杂记' + i, '花商在河边摆上几列陶盆和一篓新采的花。'.repeat(7) + i, 40, { terms: ['人物'] })),
            ],
            historyFacts: [null, fact('指路牌', '不能读取的旧缓存。', 20, { vectorNodeId: 'missing-vector' })],
        } as unknown as StoryTheaterEntry['archives'][number];
        const result = await buildStoryTheaterRecall({
            entry: { ...entry, archives: [box, { ...box, id: 'future', fromMessageId: 50, toMessageId: 50,
                facts: [fact('未来约定', future, 50)] }] },
            rows, beforeId: 50, floor: 5, baseline: '', visibleRows: [], historyVisible: false,
            continuation: false, opening: false, userInput: '冬星还指向哪里？', readOriginalEvidence: false,
        });
        const payload = result.messages.map(message => message.content).join('\n');
        expect(payload).toContain(copied);
        expect(payload).not.toMatch(/已删除的蓝色入口|未来的白桦谷约定|不能读取的旧缓存/u);
        expect(result.receipt.relatedFloors).toEqual([1, 2, 3]);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('Embedding 响应体挂起后中止一次请求并使用本地记忆', async () => {
        const id = 'embedding-timeout';
        const charId = storyTheaterThreadId(entry.id);
        const node = { id, charId, content: '档案写明备用钥匙在铜盒。', tags: ['备用钥匙'], embedded: true,
            room: 'living_room' as const, mood: 'neutral' as const, importance: 5, createdAt: 0, lastAccessedAt: 0, accessCount: 0 };
        await MemoryVectorDB.save({ memoryId: id, charId, vector: [1, 0], dimensions: 2, model: 'test' });
        let dispatched!: () => void;
        const started = new Promise<void>(resolve => { dispatched = resolve; });
        fetchMock.mockImplementationOnce(async () => {
            dispatched();
            return { ok: true, json: () => new Promise(() => {}) };
        });
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            const recall = selectStoryVectorRecall({ nodes: [], groups: [] }, '备用钥匙在哪',
                { baseUrl: 'https://vector.invalid/v1', apiKey: 'test', model: 'test', dimensions: 2 }, [node], true);
            await started;
            await vi.advanceTimersByTimeAsync(8000);
            const result = await recall;
            expect(result.embeddingFailed).toBe(true);
            expect(result.embeddingRequests).toBe(1);
            expect(result.semanticFactRank.has(id)).toBe(true);
            expect(fetchMock).toHaveBeenCalledOnce();
            expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('保留来源明确的分类标签，以及原文里出现的别名', () => {
        const source = new Map([[7, { text: '蓝铜扣也叫「月扣」，阿梨把它交给渡工。', authorInput: false }]]);
        const [fact] = parseStoryArchiveChanges(JSON.stringify({ changes: [{
            key: '铜扣/交付', text: '阿梨把蓝铜扣交给渡工。', sourceMessageId: 7,
            entities: [{ name: '蓝铜扣', type: 'object', aliases: ['月扣', '凭空别名'] },
                { name: '阿梨', type: 'person' }, { name: '不存在的地点', type: 'place' }],
        }] }), source, []);
        expect(fact.entities).toEqual([
            { name: '蓝铜扣', type: 'object', aliases: ['月扣'] }, { name: '阿梨', type: 'person' },
        ]);
    });

    it('长篇旧档同时注入多个计划、按编号查旧状态，并从归档楼层补回未总结的短词', async () => {
        const fact = (id: number, text: string, extra: Partial<StoryArchiveFact> = {}): StoryArchiveFact =>
            ({ key: '条目/' + id, kind: 'fact', sourceMessageId: id, text, terms: [], ...extra });
        const names = ['雪锚', '潮瓶', '塔笛', '双钥', '砂匣'];
        const plans = names.map((alias, i) => fact(i + 10,
            '巡守计划核对封条。' + '行动前要通知同班人员并检查运输路线。'.repeat(8) + i,
            { modality: 'planned', entities: [{ name: '行动' + i, type: 'event', aliases: [alias] }] }));
        const replaced = fact(2, '旧通行口位于西井。', { key: '入口/位置' });
        const current = fact(200, '如今通行口改到北亭。', { key: replaced.key });
        const rows: Message[] = Array.from({ length: 201 }, (_, index) => ({ ...messages[0], role: 'assistant',
            id: index + 1, content: index === 0 ? '铜铃挂在南门值班板。' : '坊中熄灯。' }));
        const boxes: StoryTheaterEntry['archives'] = [{
            id: 'archive', strategy: 'vector', fromMessageId: 1, toMessageId: 200, createdAt: 1, messageCount: 200,
            vectorMemoryIds: [], historyFacts: [replaced],
            facts: [current, ...plans, ...Array.from({ length: 160 }, (_, index) =>
                fact(31 + index, '围墙外的街景只有巡夜人和散开的雾。'.repeat(7) + index))],
        }];
        const recall = (userInput: string) => buildStoryTheaterRecall({
            entry: { ...entry, archives: boxes }, rows, beforeId: 201, floor: 201, baseline: '', visibleRows: [],
            historyVisible: false, continuation: false, opening: false, userInput, readOriginalEvidence: true,
        });
        const topics = await recall('请核对雪锚、潮瓶、塔笛、双钥、砂匣，还有第2、201楼。');
        const payload = topics.messages.map(message => message.content).join('\n');
        for (const plan of plans) expect(topics.receipt.injectedFloors).toContain(plan.sourceMessageId);
        expect(payload).toContain('【旧状态】旧通行口位于西井。');
        expect(payload).toContain('如今通行口改到北亭');
        expect(topics.receipt.missedFloors).toEqual([201]);
        expect((await recall('铜铃呢？')).messages.map(message => message.content).join('\n'))
            .toContain('铜铃挂在南门值班板。');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('对旧事件盒的事实正文做本地排序，即使关键词没有写进标签', async () => {
        const text = '霜锻匣的锁芯内藏着纵横蚀纹。';
        const info = Array.from({ length: 80 }, (_, index) => ({ key: '旅程/' + index, kind: 'fact' as const,
            text: index === 0 ? text : '山路很长，商旅沿石桥慢慢走过。'.repeat(10) + index,
            terms: [], sourceMessageId: index + 1 }));
        const archive = { id: 'summary-only', strategy: 'summary' as const, fromMessageId: 1, toMessageId: 80,
            messageCount: 80, createdAt: 1, facts: info };
        const result = await buildStoryTheaterRecall({ entry: { ...entry, archives: [archive] }, rows: [],
            beforeId: 100, floor: 81, baseline: '', visibleRows: [], historyVisible: false, continuation: false,
            opening: false, userInput: '霜锻匣的蚀纹可还在？', readOriginalEvidence: false });
        expect(result.messages.map(message => message.content).join('\n')).toContain(text);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('同义向量命中可以带回同一事物的旧经过和有限的原始证据', async () => {
        const id = 'look-behind';
        const thread = storyTheaterThreadId(entry.id);
        const text = '纪婆婆确认玛瑙信物目前在银盒里。';
        const old = '玛瑙信物曾经交给叶侍卫。';
        const node = { id, charId: thread, room: 'living_room' as const, mood: 'neutral' as const,
            tags: ['玛瑙信物'], content: text, embedded: true, importance: 6, createdAt: 1, lastAccessedAt: 1, accessCount: 0 };
        await MemoryNodeDB.save(node);
        await MemoryVectorDB.save({ memoryId: id, charId: thread, vector: [1, 0], dimensions: 2, model: 'test' });
        const rows: Message[] = [
            { ...messages[0], id: 10, role: 'assistant', content: old + '叶侍卫给玛瑙信物系了红缎。' },
            { ...messages[1], id: 20, role: 'assistant', content: '纪婆婆把玛瑙信物放进银盒。' },
        ];
        const fact = { key: '玛瑙信物/持有人', kind: 'fact' as const, terms: ['玛瑙信物'] };
        const boxes = [{
            id: 'old-state', strategy: 'vector' as const, fromMessageId: 10, toMessageId: 20,
            messageCount: 2, createdAt: 1, vectorMemoryIds: [id],
            facts: [{ ...fact, text, sourceMessageId: 20, vectorNodeId: id },
                ...Array.from({ length: 60 }, (_, i) => ({ key: '旅程/地点' + i, kind: 'fact' as const,
                    terms: ['旅馆'], sourceMessageId: 20, text: '路人记下旅馆旁另一条街道的景色和摊贩。'.repeat(6) + i }))],
            historyFacts: [{ ...fact, text: old, sourceMessageId: 10 }],
        }];
        fetchMock.mockResolvedValue(response({ data: [{ index: 0, embedding: [1, 0] }, { index: 1, embedding: [1, 0] }] }));
        const recalled = await buildStoryTheaterRecall({
            entry: { ...entry, archives: boxes }, rows, beforeId: 21, floor: 3, baseline: '', visibleRows: [],
            historyVisible: false, continuation: false, opening: false, userInput: '那个交接凭证之前经了谁的手？',
            readOriginalEvidence: true, embedding: { baseUrl: 'https://vector.invalid/v1', apiKey: 'test', model: 'test', dimensions: 2 },
        });
        const payload = recalled.messages.map(message => message.content).join('\n');
        expect(payload).toContain(text);
        expect(payload).toContain('【旧状态】' + old);
        expect(payload).toContain('叶侍卫给玛瑙信物系了红缎。');
        expect(fetchMock).toHaveBeenCalledOnce();
    });
});


it('records same-floor omitted facts individually and uses explicitly enabled rerank once', async () => {
    const id = messages[1].id;
    const facts: StoryArchiveFact[] = Array.from({ length: 27 }, (_, i) => ({
        key: '档案/' + i, kind: 'fact', text: '回执在档案馆。' + '旧线索待查。'.repeat(33) + i, terms: ['回执', '档案馆'], sourceMessageId: id,
    }));
    const rerank = { baseUrl: 'https://rank.invalid/v1', apiKey: 'test', model: 'rank' };
    fetchMock.mockResolvedValueOnce(response({ results: [{ index: 1, relevance_score: 0.9 }] }));
    const result = await buildStoryTheaterRecall({
        entry: { ...entry, archives: [{ ...entry.archives[0], facts }] }, rows: messages, beforeId: id + 1,
        floor: 3, baseline: '', visibleRows: [], historyVisible: false, continuation: false, opening: false,
        userInput: '回执放在哪？谁知道档案馆？', readOriginalEvidence: false, rerank,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://rank.invalid/v1/rerank');
    expect(result.receipt).toMatchObject({ rerank: 'used', routes: 3, embeddingRequests: 0 });
    expect(result.receipt.facts).toEqual(expect.arrayContaining([
        expect.objectContaining({ floor: 2, status: 'injected' }),
        expect.objectContaining({ floor: 2, status: 'budget' }),
    ]));
});
