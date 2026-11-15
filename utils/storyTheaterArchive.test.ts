import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message, StoryTheaterEntry } from '../types';
import { DB } from './db';
import { MemoryNodeDB, MemoryVectorDB } from './memoryPalace/db';
import { deleteStoryVectorMemory, loadStoryVectorRecall, selectStoryVectorRecall, updateStoryVectorMemory } from './storyTheaterVectorMemory';
import { collectStoryArchiveFacts, filterStoryArchiveBaselineRepeats, findStoryArchiveEvidence, formatStoryArchiveFacts, formatStoryArchiveProseContext, formatStoryArchiveTransitions, storyArchiveModality, parseStoryArchiveChanges, rankStoryArchiveFacts, storyArchiveNeedsRanking, storyArchiveSourceTimes, storyArchiveReadableLines, storyArchiveRepeatsPreset, storyTimeFromSource } from './storyArchiveFacts';
import { normalizeStoryArchiveGuideMaxChars, STORY_ARCHIVE_DEFAULT_GUIDE_MAX_CHARS } from './storyArchiveLength';
import { createStoryTheaterDraft, selectStoryArchiveBatch, storyTheaterThreadId } from './storyTheater';
import { archiveStoryFloorRange, archiveStoryVectorRangeInGeneration, commitStoryArchiveBatch, generateStoryArchiveDelta, parseStoryArchiveSummary, regenerateStoryArchiveSummary, revokeStoryArchive, splitStoryArchiveBatches } from './storyTheaterArchive';

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
    it('looks up semantically related old vector records before a later summary when references overflow', async () => {
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
        const message = {...messages[0],id:200,content:'怎样才能获准进去？'};
        fetchMock.mockReset().mockImplementation(async (url,init)=>{
            if (String(url).endsWith('/embeddings')) return response({data:[{index:0,embedding:[1,0,0]}]});
            const body=JSON.parse(String(init.body));
            expect(body.messages[1].content).toContain('旧关卡/通行规则');
            expect(body.messages[1].content).toContain(node.content);
            return response(completion('{"changes":[]}'));
        });
        const delta = await generateStoryArchiveDelta(story,[message],api,92,'vector',new Map(),
            {baseUrl:'https://vector.invalid/v1',apiKey:'test',model:'vector',dimensions:3});
        expect(delta.facts).toEqual([]);
        expect(fetchMock.mock.calls.map(([url])=>String(url).split('/').at(-1))).toEqual(['embeddings','completions']);
    });

    it('uses vector ranking when the actual prose budget fills below the old 6000-character gate', async () => {
        const charId = storyTheaterThreadId(entry.id);
        const text = '准入凭证归值班员保管，离开时须交还柜台，并在登记簿签字。凭证必须封存，未经登记不得转交旁人。';
        const important = { id: 'old-permit', charId, room: 'living_room' as const, mood: 'neutral' as const,
            content: text, tags: [], importance: 6, embedded: true, createdAt: 1, lastAccessedAt: 1, accessCount: 0 };
        const nodes = [important, ...Array.from({ length: 45 }, (_, index) =>
            ({ ...important, id: 'other-' + index, content: '普通日常记录。'.repeat(7) + index }))];
        const facts = nodes.map((node, index) => ({ key: node.id, kind: 'fact' as const, text: node.content,
            sourceMessageId: index + 1, vectorNodeId: node.id, terms: [] }));
        const query = '怎样才能获准进去？';
        const floorNumbers = new Map(facts.map(fact => [fact.sourceMessageId, fact.sourceMessageId]));
        expect(storyArchiveNeedsRanking(facts, floorNumbers, new Map())).toBe(true);
        expect(nodes.reduce((count, node) => count + node.content.length, 0)).toBeLessThan(6000);
        await MemoryNodeDB.save(important);
        await MemoryVectorDB.save({ memoryId: important.id, charId, vector: [1, 0, 0], dimensions: 3, model: 'vector' });
        fetchMock.mockResolvedValueOnce(response({ data: [{ index: 0, embedding: [1, 0, 0] }] }));
        const recalled = await selectStoryVectorRecall({ nodes: [], groups: [] }, query,
            { baseUrl: 'https://vector.invalid/v1', apiKey: 'test', model: 'vector', dimensions: 3 },
            nodes, storyArchiveNeedsRanking(facts, floorNumbers, new Map()));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(recalled.semanticFactRank.has(important.id)).toBe(true);
        expect(formatStoryArchiveProseContext(facts, query, floorNumbers, recalled.semanticFactRank)).toContain(text);
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
        expect(STORY_ARCHIVE_DEFAULT_GUIDE_MAX_CHARS).toBe(0);
        expect(normalizeStoryArchiveGuideMaxChars(undefined)).toBe(0);
        const longFact = '具体信息。'.repeat(1500);
        fetchMock.mockImplementation(async (_url, init) => response(structured(longFact, init)));
        const saved = await generateStoryArchiveDelta(entry, messages, api, 1, 'summary');
        expect(saved.summary).toBe('[第 1 楼] ' + longFact);
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('max_tokens');
        await expect(generateStoryArchiveDelta({ ...entry, archiveSummaryGuideMaxChars: 1200 },
            messages, api, 1, 'summary')).rejects.toThrow('1200');
        expect(fetchMock).toHaveBeenCalledTimes(2);
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
        expect(body.messages[0].content).toContain('逐楼检查');
        expect(body.messages[0].content).toContain('只是重复提及、没有变化，直接略过');
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

    it('keeps archived floors intact if one proposed fact exceeds vector capacity', async () => {
        const floors = await prepare();
        const longText = '剧情信息不可省略。'.repeat(850);
        fetchMock.mockImplementationOnce(async (_url, init) => response(structured(longText, init)));
        await expect(archiveStoryFloorRange(entry.id, floors.slice(0, 2), api, undefined, vector))
            .rejects.toThrow('单条剧情事实超过向量容量');
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

    it('keeps complete turns together and splits earlier when source text is long', () => {
        const rows = Array.from({ length: 6 }, (_, index): Message => ({
            ...messages[index % 2], id: index + 10, content: '长'.repeat(3500),
        }));
        expect(splitStoryArchiveBatches(rows).map(batch => batch.map(row => row.id))).toEqual([[10, 11], [12, 13], [14, 15]]);
    });

    it.each(['manual', 'automatic', 'regenerate', 'vector'] as const)(
        'extracts 36 rounds in six ordered requests via %s and stores individual sourced facts', async mode => {
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
            expect(ranges.map(ids => ids.length)).toEqual([12, 12, 12, 12, 12, 12]);
            expect(ranges.flat()).toEqual(floors.map(row => row.id));
            expect(inputs[1]).toContain('小林保管铜钥匙。');
            expect(inputs[5].split('本批新楼层\n')[0]).toContain('铜钥匙/持有人');
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
            expect(fetchMock).toHaveBeenCalledTimes(mode === 'vector' ? 7 : 6);
        },
    );

    it('player simulation: 91 floors, eight cheap-model batches, A-to-B-to-C, one current state and historical provenance', async () => {
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
            const segment = Number(input.match(/（第 (\d+)\/8 批）/)?.[1]);
            const eventFloors = ({ 1: [3, 7], 2: [16], 4: [42], 7: [75] } as Record<number, number[]>)[segment] ?? [];
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
        expect(inputs).toHaveLength(8);
        expect(inputs[1]).toContain('铜钥匙改由阿泽保管。');
        expect(inputs[3]).toContain('铜钥匙重新由林星保管。');
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
        expect(fetchMock).toHaveBeenCalledTimes(8);
    });

    it('stops on batch three, keeps old archive and original floors, and makes no extra requests', async () => {
        const floors = await saveLongStory();
        fetchMock.mockImplementation(async (_url, init) => {
            const { input, body } = fixture(floors, init);
            if (input.includes('（第 3/6 批）')) return new Response('服务繁忙', { status: 503 });
            return response(body);
        });
        await expect(archiveStoryFloorRange(entry.id, floors, api)).rejects.toThrow('第 3/6 批总结失败');
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect((await fresh()).archives).toEqual(entry.archives);
        const rows = await DB.getMessagesByCharId(storyTheaterThreadId(entry.id), true);
        expect(rows.slice(2)).toEqual(floors);
    });
});
